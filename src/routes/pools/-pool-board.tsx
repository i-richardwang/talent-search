import { Link, useLoaderData, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
import { toast } from "#/components/ui/toast";
import type { Decision } from "#/ingestion/publish";
import {
	StatusBadge,
	type StatusTone,
} from "#/routes/-components/status-badge";
import { TablePager } from "#/routes/-components/table-pager";
import {
	addResume,
	changePool,
	type loadImports,
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
	const [pool, setPool] = useState("external");
	const selected = board.pools.find((p) => p.id === pool) ?? board.pools[0];
	const [uploading, setUploading] = useState(false),
		[uploadError, setUploadError] = useState("");
	const [open, setOpen] = useState<{
		id: string;
		value: Awaited<ReturnType<typeof reviewResume>>;
	} | null>(null);
	const requested = useRef<string | null>(null);
	const pending = board.tasks.rows.some(
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
				try {
					await addResume({ data: form });
				} catch {
					failed.push(file.name);
				}
			}
			if (failed.length) setUploadError(`上传失败：${failed.join("、")}`);
			if (failed.length < files.length)
				toast.success(`${files.length - failed.length} 份简历已进入解析队列`);
			await router.invalidate();
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
	const active = board.tasks.rows.find(
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
						<Button>目标人才池 · {selected?.name ?? "选择"}</Button>
					</DropdownMenuTrigger>
					<DropdownMenuPortal>
						<DropdownMenuPositioner>
							<DropdownMenuPopup>
								{renderDropdownMenuItems([
									{
										type: "radio",
										value: selected?.id ?? "",
										onValueChange: setPool,
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
				<label htmlFor="pool-upload">
					导入 PDF 简历
					<Input
						id="pool-upload"
						type="file"
						accept="application/pdf,.pdf"
						multiple
						disabled={!selected || uploading}
						onChange={(e) => {
							const files = Array.from(e.target.files ?? []);
							e.target.value = "";
							if (selected) void upload(files, selected.id);
						}}
					/>
				</label>
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
				<h2>我的导入记录</h2>
				<Block variant="outlined">
					{board.tasks.rows.length ? (
						<Table
							aria-label="我的导入记录"
							narrow="cards"
							footer={
								board.tasks.pages > 1 && (
									<TablePager
										table={board.tasks}
										units={{ row: "条", total: "条" }}
										linkTo={(page) => (
											<Link
												to="/pools"
												search={{ page: page === 1 ? undefined : page }}
											/>
										)}
									/>
								)
							}
						>
							<TableHeader>
								<TableRow>
									<TableHead>文件名</TableHead>
									<TableHead>人才池</TableHead>
									<TableHead>状态</TableHead>
									<TableHead>操作</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{board.tasks.rows.map((t) => {
									const [label, tone] = statuses[t.status] ?? [
										t.status,
										"pending",
									];
									return (
										<TableRow key={t.id}>
											<TableCell cellSlot="title">{t.filename}</TableCell>
											<TableCell cellLabel="人才池">
												{board.pools.find((p) => p.id === t.pool_id)?.name}
											</TableCell>
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
						</Table>
					) : (
						<Empty
							title="还没有导入记录"
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
							candidates={open.value.candidates}
							onDecision={(choice) => resolveTask(open.id, choice)}
						/>
					</div>
				)}
			</Modal>
		</div>
	);
}

function PoolSettings({
	selected,
}: {
	selected: Board["pools"][number] | undefined;
}) {
	const router = useRouter();
	const [opened, setOpened] = useState(false),
		[mode, setMode] = useState<"edit" | "new">(selected ? "edit" : "new"),
		[saving, setSaving] = useState(false);
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
				<form
					key={mode}
					className="grid gap-2 py-3"
					onSubmit={async (e) => {
						e.preventDefault();
						if (saving) return;
						const values = new FormData(e.currentTarget);
						setSaving(true);
						try {
							await changePool({
								data: {
									id: mode === "edit" ? selected?.id : undefined,
									name: String(values.get("name")),
									org: String(values.get("org")).trim() || null,
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
					<Segmented
						aria-label="管理方式"
						value={mode}
						onChange={setMode}
						options={[
							{ value: "edit", label: "调整所选池" },
							{ value: "new", label: "新建人才池" },
						]}
					/>
					{mode === "edit" && selected && (
						<span>
							{selected.creator} · 创建于 {selected.created}
						</span>
					)}
					<label htmlFor="pool-name">
						池名
						<Input
							id="pool-name"
							name="name"
							defaultValue={mode === "edit" ? selected?.name : ""}
							required
						/>
					</label>
					<label htmlFor="pool-org">
						部门路径（留空即公开）
						<Input
							id="pool-org"
							name="org"
							defaultValue={mode === "edit" ? (selected?.org_path ?? "") : ""}
						/>
					</label>
					<Button
						htmlType="submit"
						disabled={mode === "edit" && !selected}
						loading={saving}
					>
						保存人才池
					</Button>
				</form>
			</Collapsible>
		</section>
	);
}
