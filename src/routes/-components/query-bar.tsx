import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "#/components/ui/input-group";
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
 * 框和按钮是**一块面**（`InputGroup`），不是并排的两块。它们是一个动作的两半，
 * 中间隔一道 8px 的缝就成了两件事，而且会得到两条顶光边、两个圆角、两套焦点环。
 * 收进同一块面之后焦点环也只有一个——它长在整块面上，落在框里还是按钮上都对。
 *
 * 提交按钮不用实心主色：这一屏的主行动是「找人」，不是「加一个词」。给它最重
 * 的一档，屏幕上对比度最高的东西就成了往查询里追加一个字段的次要动作。
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
			className="w-full"
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
			<InputGroup>
				{/* 放大镜在框里，不在按钮上：它说的是「这个框是用来搜的」，
				    而按钮上那两个字说的是按下去会发生什么，两件事。 */}
				<InputGroupAddon align="inline-start">
					<SearchIcon />
				</InputGroupAddon>
				<InputGroupInput
					aria-label={header ? "添加搜索条件" : "搜索人才"}
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
				<InputGroupAddon align="inline-end">
					<Button
						loading={busy}
						render={<button type="submit" />}
						size={header ? "xs" : "sm"}
						variant="secondary"
					>
						{header ? "添加" : "搜索"}
					</Button>
				</InputGroupAddon>
			</InputGroup>
		</form>
	);
}
