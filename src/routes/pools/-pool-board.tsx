import {
	Link,
	useLoaderData,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { OrgPicker } from "#/components/org-picker";
import { emptyTouch, TouchFields } from "#/components/touch-fields";
import { Alert } from "#/components/ui/alert";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import {
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { Empty } from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import { Modal } from "#/components/ui/modal";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { TextLink } from "#/components/ui/text-link";
import { toast } from "#/components/ui/toast";
import type { Decision } from "#/ingestion/publish";
import { dots } from "#/lib/format";
import type { OrgNode } from "#/lib/org";
import {
	StatusBadge,
	type StatusTone,
} from "#/routes/-components/status-badge";
import { TablePager } from "#/routes/-components/table-pager";
import {
	addResume,
	changePool,
	type loadImports,
	poolOrganizations,
	reviewResume,
	submitDecision,
} from "#/server/talent-functions";
import { ResumeReview } from "./-resume-review";

type Board = Awaited<ReturnType<typeof loadImports>>;
const statuses: Record<string, [string, StatusTone]> = {
	queued: ["等待解析", "pending"],
	processing: ["正在解析", "running"],
	review: ["待确认", "interrupted"],
	added: ["已入池", "success"],
	duplicate: ["已存在", "success"],
	cancelled: ["已放弃", "pending"],
	failed: ["解析未完成", "error"],
};
function reviewable(status: string) {
	return status === "review" || status === "failed";
}
function showError(error: unknown) {
	toast.error(error instanceof Error ? error.message : "操作未完成");
}

export function PoolBoard({ board }: { board: Board }) {
	const { user } = useLoaderData({ from: "__root__" }),
		router = useRouter();
	const navigate = useNavigate({ from: "/pools" });
	const selected = board.pools.find((p) => p.id === board.selected);
	const { list } = board;
	const tasks = list.tab === "imports" ? list.table : null;
	const [touch, setTouch] = useState(emptyTouch),
		[uploadError, setUploadError] = useState(""),
		[uploading, setUploading] = useState(false);
	function search(
		pool: string | undefined,
		tab: "members" | "imports",
		page = 1,
	) {
		return {
			poolId: pool,
			tab: tab === "imports" ? ("imports" as const) : undefined,
			page: page === 1 ? undefined : page,
		};
	}
	const [open, setOpen] = useState<{
		id: string;
		value: Awaited<ReturnType<typeof reviewResume>>;
	} | null>(null);
	const requested = useRef<string | null>(null);
	const pending = tasks?.rows.some(
		(t) => t.status === "queued" || t.status === "processing",
	);
	useEffect(() => {
		if (!pending) return;
		const timer = setInterval(() => void router.invalidate(), 2000);
		return () => clearInterval(timer);
	}, [pending, router]);
	async function upload(files: File[], poolId: string) {
		if (!files.length) return;
		setUploading(true);
		setUploadError("");
		try {
			const failed: string[] = [];
			for (const file of files) {
				const form = new FormData();
				form.set("pool", poolId);
				form.set("file", file);
				form.set("notes", touch.notes);
				if (touch.touched) form.set("touched", touch.touched);
				try {
					await addResume({ data: form });
				} catch {
					failed.push(file.name);
				}
			}
			if (failed.length) setUploadError(`上传失败：${failed.join("、")}`);
			if (failed.length < files.length) {
				toast.success(`${files.length - failed.length} 份简历已提交`);
				setTouch(emptyTouch);
				await navigate({ search: search(poolId, "imports") });
				await router.invalidate();
			}
		} catch (e) {
			showError(e);
		} finally {
			setUploading(false);
		}
	}
	function closeReview() {
		requested.current = null;
		setOpen(null);
	}
	async function openReview(id: string) {
		requested.current = id;
		try {
			const value = await reviewResume({ data: id });
			if (requested.current === id) setOpen({ id, value });
		} catch (e) {
			showError(e);
		}
	}
	async function resolveTask(id: string, choice: Decision | "retry") {
		try {
			await submitDecision({ data: { id, choice } });
			if (requested.current === id) closeReview();
			await router.invalidate();
		} catch (e) {
			showError(e);
		}
	}
	const active = tasks?.rows.find(
		(t) => t.id === open?.id && reviewable(t.status),
	);
	return (
		<div className="flex flex-col gap-5">
			<Block
				variant="outlined"
				className="flex flex-wrap items-center gap-3 p-4"
			>
				<DropdownMenuRoot>
					<DropdownMenuTrigger>
						<Button disabled={uploading}>
							目标人才池 · {selected?.name ?? "选择"}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuPortal>
						<DropdownMenuPositioner>
							<DropdownMenuPopup>
								{renderDropdownMenuItems([
									{
										type: "radio",
										value: selected?.id ?? "",
										onValueChange: (id) => {
											setTouch(emptyTouch);
											void navigate({ search: search(id, list.tab) });
										},
										options: board.pools.map((p) => ({
											value: p.id,
											label: p.name,
											extra: p.org_path ?? "所有登录账号",
										})),
									},
								])}
							</DropdownMenuPopup>
						</DropdownMenuPositioner>
					</DropdownMenuPortal>
				</DropdownMenuRoot>
				{selected && (
					<span className="text-fg-secondary text-sm">
						可见范围 · {selected.org_path ?? "所有登录账号"}
					</span>
				)}
				<form
					key={selected?.id}
					className="grid w-full gap-3"
					onSubmit={async (e) => {
						e.preventDefault();
						if (!selected || uploading) return;
						const form = e.currentTarget;
						const input = form.elements.namedItem("files") as HTMLInputElement;
						const files = Array.from(input.files ?? []);
						input.value = "";
						await upload(files, selected.id);
					}}
				>
					<label htmlFor="pool-upload">
						PDF 简历
						<Input
							id="pool-upload"
							name="files"
							required
							type="file"
							accept="application/pdf,.pdf"
							multiple
							disabled={!selected || uploading}
						/>
					</label>
					<TouchFields value={touch} onChange={setTouch} />
					<p className="text-sm text-fg-secondary">
						接触信息选填。批量上传时，每份简历分别记入这条接触记录。
					</p>
					<Button htmlType="submit" loading={uploading} disabled={!selected}>
						上传简历
					</Button>
				</form>
			</Block>
			{uploadError && (
				<Alert
					type="error"
					title={uploadError}
					onClose={() => setUploadError("")}
				/>
			)}
			{user?.admin && <PoolSettings selected={selected} key={selected?.id} />}
			<section className="grid gap-3">
				<Segmented
					aria-label="人才池视图"
					value={list.tab}
					onChange={(tab) =>
						void navigate({ search: search(selected?.id, tab) })
					}
					options={[
						{ value: "members", label: "池内候选人" },
						{ value: "imports", label: "我的导入记录" },
					]}
				/>
				<Block variant="outlined">
					{list.table.rows.length ? (
						<Table
							narrow="cards"
							aria-label={
								list.tab === "members" ? "池内候选人" : "我的导入记录"
							}
							footer={
								list.table.pages > 1 && (
									<TablePager
										table={list.table}
										units={
											list.tab === "members"
												? { row: "位", total: "人" }
												: { row: "条", total: "条" }
										}
										linkTo={(page) => (
											<Link
												to="/pools"
												search={search(selected?.id, list.tab, page)}
											/>
										)}
									/>
								)
							}
						>
							{list.tab === "members" ? (
								<>
									<TableHeader>
										<TableRow>
											<TableHead>姓名</TableHead>
											<TableHead>最近公司 / 岗位</TableHead>
											<TableHead>最近接触日期</TableHead>
											<TableHead>接触备注</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{list.table.rows.map((m) => {
											const detail = {
												to: "/data/$personId",
												params: { personId: m.personId },
												search: { q: "", page: undefined },
											} as const;
											return (
												<TableRow
													key={m.personId}
													onActivate={() => void router.navigate(detail)}
												>
													<TableCell cellSlot="title">
														<TextLink
															render={<Link {...detail} preload={false} />}
															tabIndex={-1}
														>
															{m.name}
														</TextLink>
													</TableCell>
													<TableCell cellLabel="最近公司 / 岗位">
														{dots(m.company, m.title) || "—"}
													</TableCell>
													<TableCell cellLabel="最近接触日期">
														{m.touched ?? "—"}
													</TableCell>
													<TableCell cellLabel="接触备注">
														{m.notes || "—"}
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</>
							) : (
								<>
									<TableHeader>
										<TableRow>
											<TableHead>文件名</TableHead>
											<TableHead>状态</TableHead>
											<TableHead>操作</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{list.table.rows.map((t) => {
											const [label, tone] = statuses[t.status] ?? [
												t.status,
												"pending",
											];
											return (
												<TableRow key={t.id}>
													<TableCell cellSlot="title">{t.filename}</TableCell>
													<TableCell cellLabel="状态">
														<StatusBadge tone={tone}>{label}</StatusBadge>
														{t.message && (
															<p className="text-fg-secondary text-sm">
																{t.message}
															</p>
														)}
													</TableCell>
													<TableCell cellLabel="操作">
														<div className="flex flex-wrap gap-2">
															{reviewable(t.status) && (
																<Button
																	size="small"
																	onClick={() => openReview(t.id)}
																>
																	确认简历
																</Button>
															)}
															{t.status === "failed" && (
																<Button
																	size="small"
																	onClick={() => resolveTask(t.id, "retry")}
																>
																	重新解析
																</Button>
															)}
															{t.person_id && (
																<Button
																	size="small"
																	render={
																		<Link
																			to="/data/$personId"
																			params={{ personId: t.person_id }}
																			search={{ q: "", page: undefined }}
																			preload={false}
																		/>
																	}
																>
																	查看档案
																</Button>
															)}
														</div>
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</>
							)}
						</Table>
					) : (
						<Empty
							title={
								list.tab === "members" ? "池内还没有候选人" : "还没有导入记录"
							}
							description="选择人才池并上传 PDF 简历。"
						/>
					)}
				</Block>
			</section>
			<Modal
				noFooter
				open={!!open && !!active}
				className="max-w-(--container-page)"
				title={`确认简历 · ${active?.filename ?? ""}`}
				onCancel={closeReview}
			>
				{open && active && (
					<div className="grid gap-3">
						{active.message && <Alert type="warning" title={active.message} />}
						<ResumeReview
							key={open.id}
							taskId={open.id}
							initial={open.value.draft}
							initialTouch={open.value.touch}
							candidates={open.value.candidates}
							onDecision={(choice) => resolveTask(open.id, choice)}
						/>
					</div>
				)}
			</Modal>
		</div>
	);
}

type Pool = Board["pools"][number];
function PoolSettings({ selected }: { selected?: Pool }) {
	const [opened, setOpened] = useState(false),
		[mode, setMode] = useState<"edit" | "new">(selected ? "edit" : "new");
	return (
		<section>
			<CollapsibleTrigger
				open={opened}
				panelId="pool-settings"
				onOpenChange={setOpened}
			>
				管理人才池
			</CollapsibleTrigger>
			<Collapsible id="pool-settings" open={opened}>
				{selected && (
					<Segmented
						aria-label="管理方式"
						value={mode}
						onChange={setMode}
						options={[
							{ value: "edit", label: "调整所选池" },
							{ value: "new", label: "新建人才池" },
						]}
					/>
				)}
				<PoolForm
					key={mode}
					selected={mode === "edit" ? selected : undefined}
				/>
			</Collapsible>
		</section>
	);
}
function PoolForm({ selected }: { selected?: Pool }) {
	const router = useRouter();
	const [visibility, setVisibility] = useState<"public" | "org">(
			selected?.org_path ? "org" : "public",
		),
		[org, setOrg] = useState(selected?.org_path ?? ""),
		[tree, setTree] = useState<OrgNode[] | null>(null),
		[saving, setSaving] = useState(false);
	useEffect(() => {
		if (visibility !== "org") return;
		let alive = true;
		poolOrganizations()
			.then((nodes) => {
				if (alive) setTree(nodes);
			})
			.catch((e) => {
				if (alive) showError(e);
			});
		return () => {
			alive = false;
		};
	}, [visibility]);
	return (
		<form
			className="grid gap-3 py-3"
			onSubmit={async (e) => {
				e.preventDefault();
				if (saving || (visibility === "org" && !org)) return;
				const name = String(new FormData(e.currentTarget).get("name"));
				setSaving(true);
				try {
					await changePool({
						data: {
							id: selected?.id,
							name,
							org: visibility === "org" ? org : null,
						},
					});
					await router.invalidate();
					toast.success("人才池已保存");
				} catch (e) {
					showError(e);
				} finally {
					setSaving(false);
				}
			}}
		>
			{selected && (
				<span>
					{selected.creator} · 创建于 {selected.created}
				</span>
			)}
			<label htmlFor="pool-name">
				池名
				<Input
					id="pool-name"
					name="name"
					defaultValue={selected?.name ?? ""}
					required
				/>
			</label>
			<Segmented
				aria-label="可见范围"
				value={visibility}
				onChange={setVisibility}
				options={[
					{ value: "public", label: "所有登录账号" },
					{ value: "org", label: "按部门授权" },
				]}
			/>
			{visibility === "org" && (
				<OrgPicker
					single
					tree={tree}
					value={org ? [org] : []}
					onChange={(paths) => setOrg(paths[0] ?? "")}
				/>
			)}
			<Button
				htmlType="submit"
				loading={saving}
				disabled={visibility === "org" && !org}
			>
				保存人才池
			</Button>
		</form>
	);
}
