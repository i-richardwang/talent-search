import { PlusIcon, SearchIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import type { QueryInput } from "#/search/parse";

/**
 * 输入框。两种用法，差别只有一处：**它写查询还是加查询**。
 *
 * - `hero`（零态）：这是第一句话，写下整个查询。
 * - `header`（工作台）：查询已经变成一排 chip 了，这里只负责往上加。提交完就
 *   清空，因为已经搜过的条件在 chip 上看得见、改得动——把原话再留在框里，
 *   等于同一份东西摆两遍，而那两遍还会不一致（改了 chip，框里还是老句子）。
 *
 * 所以这里没有「把 URL 同步回输入框」的 effect：查询的唯一表示是 chips，
 * 前进后退换掉 URL 时跟着变的是它们，不是这个框。
 *
 * 提交是**异步**的，但只异步一次 INSERT 那么久：整句的查询理解不在这条路上，
 * 它在工作台里补（见 `s/$turnId/route.tsx`），所以按下去到界面变化之间没有
 * 一段以模型延迟为长度的空白。这个文件只多管一件事——
 * **原话在提交成功之前不清空**：中途清空等于把人刚敲的东西吞了，
 * 而这一步是会失败的，吞掉之后连重试都没得重试。
 *
 * 出去的永远是 `sentence`：框里是一句话，标签就在造出它的地方打上，
 * 不由上游去猜。
 */
export function QueryBar({
	onQuery,
	inputRef,
	variant,
}: {
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	/** 键盘流的 `/` 要能聚焦到它。零态没有那套快捷键，所以是可选的。 */
	inputRef?: React.RefObject<HTMLInputElement | null>;
	variant: "hero" | "header";
}) {
	const header = variant === "header";
	const [draft, setDraft] = useState("");
	const draftRef = useRef("");
	const [busy, setBusy] = useState(false);

	return (
		// 吃满容器：它住在版心里，左右边缘就是名单卡片的左右边缘，
		// 不必自己再限一次宽。
		<form
			className="flex w-full gap-2"
			onSubmit={async (e) => {
				e.preventDefault();
				const q = draft.trim();
				if (!q || busy) return;
				setBusy(true);
				try {
					// 提交期间人还能接着敲。清空只针对**刚才提交的那句**，
					// 敲进去的新内容不能被一次迟到的返回吞掉。
					const ok = await onQuery({ kind: "sentence", text: q });
					if (ok && draftRef.current.trim() === q) {
						draftRef.current = "";
						setDraft("");
					}
				} finally {
					setBusy(false);
				}
			}}
		>
			<Input
				aria-label={header ? "添加搜索条件" : "搜索人才"}
				className="min-w-0 flex-1"
				onChange={(e) => {
					draftRef.current = e.target.value;
					setDraft(e.target.value);
				}}
				placeholder={header ? "添加岗位、经验或能力" : "输入岗位、经验或能力"}
				ref={inputRef}
				/* 工作台里它也走默认档，不缩成 `sm`：查询台上这个框是这一屏
				   唯一的输入入口，缩一档只会让它读起来像一个次要的过滤框。 */
				size={header ? "default" : "lg"}
				value={draft}
			/>
			<Button
				loading={busy}
				render={<button type="submit" />}
				size={header ? "default" : "lg"}
			>
				{header ? <PlusIcon /> : <SearchIcon />}
				{header ? "添加" : "搜索"}
			</Button>
		</form>
	);
}
