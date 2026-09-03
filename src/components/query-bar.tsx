import { ArrowUpIcon, SearchIcon } from "lucide-react";
import { useImperativeHandle, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupTextarea,
} from "#/components/ui/input-group";
import type { QueryInput } from "#/search/spec";

/** 外面能对这个框做的事。填入不提交：例子是起点，不是答案。 */
export type QueryBarHandle = {
	/** 聚焦，并选中框里已有的内容——从外面来的聚焦总是为了改写它。 */
	focus: () => void;
	/** 填一句话进去并聚焦，光标落在末尾。不提交。 */
	fill: (text: string) => void;
};

/**
 * 输入框。两种用法，差别不只是尺码，是**它写查询还是加查询**。
 *
 * - `hero`（零态）：这是第一句话，写下整个查询。所以它是一块**面**：多行的
 *   `textarea` 加一条底栏（`InputGroupAddon align="block-end"`，coss 自己给
 *   这种组合备好的排法）。一句话里要放好几个条件，单行框写到一半就看不见
 *   开头了；而这一屏只有这一件事可做，它有资格占掉那么大一块。
 * - `header`（工作台）：查询已经变成一排 chip 了，这里只负责往上加。单行、
 *   走默认档，提交完就清空——已经搜过的条件在 chip 上看得见、改得动，
 *   把原话再留在框里等于同一份东西摆两遍，而那两遍还会不一致。
 *
 * 所以这里不把查询记录同步回输入框：工作台上的唯一可编辑表示是 chips，
 * 前进后退换记录时跟着变的是它们，不是这个框。
 *
 * 框和按钮是**一块面**（`InputGroup`），不是并排的两块。它们是一个动作的两半，
 * 中间隔一道 8px 的缝就成了两件事，而且会得到两条顶光边、两个圆角、两套焦点环。
 * 收进同一块面之后焦点环也只有一个——它长在整块面上，落在框里还是按钮上都对。
 *
 * 尺码一律走组件自己的 `size` / `variant`，不拿 `h-14`、`rounded-xl` 这种任意值
 * 去撑。撑一次，内边距、`before:` 顶光边的圆角、图标与文字的间距就全都不再是
 * 那套算好的关系，凑近看是「仿的 coss」。
 *
 * 提交是**异步**的，但只异步一次 INSERT 那么久：整句的查询理解不在这条路上，
 * 它在工作台里补（见 `s/$turnId/route.tsx`），所以按下去到界面变化之间没有
 * 一段以模型延迟为长度的空白。这个文件只多管一件事——
 * **原话在提交成功之前不清空**：中途清空等于把人刚敲的东西吞了，
 * 而这一步是会失败的，吞掉之后连重试都没得重试。
 *
 * 出去的永远是 `sentence`：框里是一句话，标签就在造出它的地方打上，
 * 不由上游去猜。
 *
 * 草稿归它自己，外面只能通过 `QueryBarHandle` 做那两个动作——**填一句进来**
 * 和**聚焦**。写成一个受控的 value 的话，两个用法各要一份草稿状态和一份清空
 * 逻辑，而「提交成功才清空」这条规则就得在每个调用方各写一遍。
 */
export function QueryBar({
	onQuery,
	ref,
	variant,
	disabled = false,
}: {
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	/** 键盘流的 `/` 要聚焦到它，零态的示例要往里填。都不用时可以不给。 */
	ref?: React.Ref<QueryBarHandle>;
	variant: "hero" | "header";
	/** 父查询还没形成 chips 时不能再派生下一条。 */
	disabled?: boolean;
}) {
	const header = variant === "header";
	const [draft, setDraft] = useState("");
	const draftRef = useRef("");
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
	const formRef = useRef<HTMLFormElement>(null);

	// 光标不用手动摆：受控的 value 变长之后浏览器把插入点留在末尾，
	// 而 `focus()` 先发生，所以填完就能接着敲。
	useImperativeHandle(ref, () => ({
		focus: () => {
			inputRef.current?.focus();
			inputRef.current?.select();
		},
		fill: (text) => {
			draftRef.current = text;
			setDraft(text);
			inputRef.current?.focus();
		},
	}));

	const shared = {
		disabled,
		onChange: (
			e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
		) => {
			draftRef.current = e.target.value;
			setDraft(e.target.value);
		},
		value: draft,
	};

	return (
		// 吃满容器：它住在版心里，左右边缘就是名单卡片的左右边缘，
		// 不必自己再限一次宽。
		<form
			className="w-full"
			onSubmit={async (e) => {
				e.preventDefault();
				const q = draft.trim();
				if (!q || busy || disabled) return;
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
			ref={formRef}
		>
			<InputGroup>
				{header ? (
					<>
						{/* 放大镜在框里，不在右端：它说的是「这个框是用来搜的」，
						    而右端那一格说的是按下去会发生什么，两件事，各占一头。 */}
						<InputGroupAddon align="inline-start">
							<SearchIcon />
						</InputGroupAddon>
						<InputGroupInput
							aria-label="添加搜索条件"
							placeholder="添加岗位、经验或能力"
							ref={inputRef as React.Ref<HTMLInputElement>}
							/* 不缩成 `sm`：查询台上这个框是这一屏唯一的输入入口，
							   缩一档只会让它读起来像一个次要的过滤框。 */
							size="default"
							{...shared}
						/>
						<InputGroupAddon align="inline-end">
							<Button
								disabled={disabled}
								loading={busy}
								render={<button type="submit" />}
								size="xs"
								variant="secondary"
							>
								添加
							</Button>
						</InputGroupAddon>
					</>
				) : (
					<>
						<InputGroupTextarea
							aria-label="搜索人才"
							/* 进这一屏只有一件事可做，让人再点一下框纯属多余。工作台上
							   不自动聚焦——那一屏的主体是名单，抢焦点会把手机的软键盘
							   顶上来，把刚搜到的人挡掉一半。 */
							autoFocus
							onKeyDown={(e) => {
								// 回车即搜，Shift+回车换行。`isComposing` 那一条是给中文
								// 输入法的：选字时的回车是「确认这个词」，不是「搜」，
								// 不挡住的话每打一个词就会提交一次。
								if (e.key !== "Enter" || e.shiftKey) return;
								if (e.nativeEvent.isComposing) return;
								e.preventDefault();
								formRef.current?.requestSubmit();
							}}
							placeholder="用一句话说要找什么样的人"
							ref={inputRef as React.Ref<HTMLTextAreaElement>}
							{...shared}
						/>
						{/* 底栏而不是右端的一格：这块面高得多，一个贴在右边缘中间的
						    按钮会浮在一大片空白里。coss 的 `block-end` 就是给这种
						    「上面写字、下面一条动作栏」备的排法。 */}
						<InputGroupAddon align="block-end">
							<Button
								aria-label="搜索"
								className="ms-auto"
								disabled={disabled || draft.trim() === ""}
								loading={busy}
								render={<button type="submit" />}
								size="icon-sm"
								variant="secondary"
							>
								<ArrowUpIcon />
							</Button>
						</InputGroupAddon>
					</>
				)}
			</InputGroup>
		</form>
	);
}
