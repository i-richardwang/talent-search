import {
	Link,
	useLoaderData,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import {
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import { Segmented } from "#/components/ui/segmented";
import {
	addResume,
	changePool,
	type loadImports,
	reviewResume,
	submitDecision,
} from "#/server/talent-functions";
import { ResumeReview } from "./-resume-review";

const status: Record<string, string> = {
	queued: "等待解析",
	processing: "正在解析",
	review: "待确认",
	added: "已入池",
	duplicate: "已存在",
	cancelled: "已放弃",
	failed: "解析未完成",
};
export function PoolBoard({
	board,
}: {
	board: Awaited<ReturnType<typeof loadImports>>;
}) {
	const { user } = useLoaderData({ from: "__root__" }),
		router = useRouter(),
		nav = useNavigate({ from: "/pools" });
	const [pool, setPool] = useState(
		board.pools.find((p) => p.id === "external")?.id ??
			board.pools[0]?.id ??
			"",
	);
	const [mode, setMode] = useState<"edit" | "new">("edit");
	const selected = board.pools.find((p) => p.id === pool);
	const [err, error] = useState(""),
		[busy, setBusy] = useState(false);
	const [open, setOpen] = useState<{
		id: string;
		value: Awaited<ReturnType<typeof reviewResume>>;
	} | null>(null);
	const pending = board.tasks.some(
		(t) => t.status === "queued" || t.status === "processing",
	);
	useEffect(() => {
		if (!pending) return;
		const id = setInterval(() => void router.invalidate(), 2000);
		return () => clearInterval(id);
	}, [pending, router]);
	async function run(work: () => Promise<unknown>) {
		setBusy(true);
		error("");
		try {
			await work();
			await router.invalidate();
		} catch (e) {
			error(e instanceof Error ? e.message : "操作未完成");
		} finally {
			setBusy(false);
		}
	}
	return (
		<fieldset disabled={busy} className="flex flex-col gap-5">
			{err && <p role="alert">{err}</p>}
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
										value: pool,
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
					<span>可见范围 · {selected.org_path ?? "所有登录账号"}</span>
				)}
				<label htmlFor="pool-upload">
					导入 PDF 简历{" "}
					<Input
						id="pool-upload"
						type="file"
						multiple
						accept="application/pdf,.pdf"
						disabled={!selected}
						onChange={(e) => {
							const files = [...(e.target.files ?? [])];
							e.target.value = "";
							void run(async () => {
								const failed: string[] = [];
								for (const file of files) {
									const form = new FormData();
									form.set("pool", pool);
									form.set("file", file);
									try {
										await addResume({ data: form });
									} catch {
										failed.push(file.name);
									}
								}
								if (failed.length)
									error(`以下文件未能上传：${failed.join("、")}`);
							});
						}}
					/>
				</label>
			</Block>
			{user?.admin && (
				<details key={pool}>
					<summary>管理人才池</summary>
					<form
						key={mode}
						className="grid gap-2 py-3"
						onSubmit={(e) => {
							e.preventDefault();
							const data = new FormData(e.currentTarget);
							void run(() =>
								changePool({
									data: {
										id: mode === "new" ? undefined : pool,
										name: String(data.get("name")),
										org: String(data.get("org")).trim() || null,
									},
								}),
							);
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
						<Button htmlType="submit">保存人才池</Button>
					</form>
				</details>
			)}
			<h2>我的导入记录（{board.total}）</h2>
			{board.tasks.map((t) => (
				<Block key={t.id} variant="outlined" className="grid gap-3 p-4">
					<div className="flex flex-wrap items-center gap-3">
						<strong>{t.filename}</strong>
						<span>{status[t.status]}</span>
						{t.message && <span>{t.message}</span>}
						{(t.status === "review" || t.status === "failed") && (
							<Button
								onClick={() =>
									void run(async () =>
										setOpen({
											id: t.id,
											value: await reviewResume({ data: t.id }),
										}),
									)
								}
							>
								确认档案
							</Button>
						)}
						{t.status === "failed" && (
							<Button
								onClick={() =>
									void run(() =>
										submitDecision({ data: { id: t.id, choice: "retry" } }),
									)
								}
							>
								重新解析
							</Button>
						)}
						{t.person_id && (
							<Link
								to="/data/$personId"
								params={{ personId: t.person_id }}
								search={{ q: "", page: undefined }}
								preload={false}
							>
								查看档案
							</Link>
						)}
					</div>
					{open?.id === t.id && (
						<ResumeReview
							candidates={open.value.candidates}
							initial={open.value.draft}
							onDecision={(choice) =>
								void run(async () => {
									await submitDecision({ data: { id: t.id, choice } });
									setOpen(null);
								})
							}
						/>
					)}
				</Block>
			))}
			{board.pages > 1 && (
				<div>
					<Button
						disabled={board.page <= 1}
						onClick={() => void nav({ search: { page: board.page - 1 } })}
					>
						上一页
					</Button>{" "}
					{board.page} / {board.pages}{" "}
					<Button
						disabled={board.page >= board.pages}
						onClick={() => void nav({ search: { page: board.page + 1 } })}
					>
						下一页
					</Button>
				</div>
			)}
		</fieldset>
	);
}
