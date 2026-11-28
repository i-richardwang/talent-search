import {
	Link,
	useLoaderData,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Alert } from "#/components/ui/alert";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";

import { Empty } from "#/components/ui/empty";
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
import type { Decision } from "#/ingestion/decision";
import { dots } from "#/lib/format";
import {
	StatusBadge,
	type StatusTone,
} from "#/routes/-components/status-badge";
import { TablePager } from "#/routes/-components/table-pager";
import {
	type loadPoolBoard,
	reviewResume,
	submitDecision,
} from "#/server/talent-functions";
import { PoolSettings } from "./-pool-settings";
import { ResumeReview } from "./-resume-review";
import { ResumeUpload } from "./-resume-upload";

type Board = Awaited<ReturnType<typeof loadPoolBoard>>;
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
	const { user } = useLoaderData({ from: "__root__" });
	const router = useRouter();
	const navigate = useNavigate({ from: "/pools" });
	const selected = board.pools.find((p) => p.id === board.selected);
	const { list } = board;
	const tasks = list.tab === "imports" ? list.table : null;
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
			<ResumeUpload
				key={selected?.id}
				pools={board.pools}
				selected={selected}
				onPoolChange={(id) => void navigate({ search: search(id, list.tab) })}
				onUploaded={async (id) => {
					await navigate({ search: search(id, "imports") });
					await router.invalidate();
				}}
			/>
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
