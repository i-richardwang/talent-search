import { ArrowUpIcon } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupTextarea,
} from "#/components/ui/input-group";
import type { QueryInput } from "#/search/spec";

/** 外面能对这个框做的事。填入不提交：例子是起点，不是答案。 */
export type QueryBarHandle = {
	/** 填一句话进去并聚焦，光标落在末尾。不提交。 */
	fill: (text: string) => void;
};

/**
 * 写查询的那个框。**全站只有这一个形状**：零态写下第一句，工作台改写同一句，
 * 两处做的是同一件事——把「我要找什么人」说成一句话——所以它们不该长成两样。
 *
 * 是一块**面**，不是一条横带：多行的 `textarea` 加一条底栏
 * （`InputGroupAddon align="block-end"`，coss 自己给这种组合备好的排法）。
 * 一句话里要放好几个条件，单行框写到一半就看不见开头了。
 *
 * 框和按钮是一块面（`InputGroup`），不是并排的两块。它们是一个动作的两半，
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
 * 草稿归它自己。写成一个受控的 value 的话，两个用法各要一份草稿状态和一份
 * 清空逻辑，而「提交成功才清空」这条规则就得在每个调用方各写一遍。
 */
export function QueryBar({
	onQuery,
	ref,
	initial = "",
	onCancel,
}: {
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	/** 零态的例子要往里填。工作台不用——它靠挂载时的 `initial` 就位。 */
	ref?: React.Ref<QueryBarHandle>;
	/** 打开时框里已有的话。工作台带着当前这句原话进来，于是「改」就是改它。 */
	initial?: string;
	/** 有出路才给取消：工作台的改写可以收起来，零态没有可退回的地方。 */
	onCancel?: () => void;
}) {
	const [draft, setDraft] = useState(initial);
	const draftRef = useRef(initial);
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const formRef = useRef<HTMLFormElement>(null);

	// 挂载即就位：这个框只在「现在就要写这句话」的时候存在——零态整屏就这一件
	// 事，工作台上它是点了那支铅笔（「改写这句话」）才展开的。光标落在末尾，
	// 于是带着原话打开之后可以直接接着写。
	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
	}, []);

	// 光标不用手动摆：受控的 value 变长之后浏览器把插入点留在末尾，
	// 而 `focus()` 先发生，所以填完就能接着敲。
	useImperativeHandle(ref, () => ({
		fill: (text) => {
			draftRef.current = text;
			setDraft(text);
			inputRef.current?.focus();
		},
	}));

	return (
		// 吃满容器：宽度由摆它的那一屏说了算——零态摆在版心里，工作台摆在抬头
		// 那条带里——所以这里不自己再限一次宽。
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
			ref={formRef}
		>
			<InputGroup>
				<InputGroupTextarea
					aria-label="搜索人才"
					onChange={(e) => {
						draftRef.current = e.target.value;
						setDraft(e.target.value);
					}}
					onKeyDown={(e) => {
						if (e.key === "Escape" && onCancel && !busy) {
							e.preventDefault();
							onCancel();
							return;
						}
						// 回车即搜，Shift+回车换行。`isComposing` 那一条是给中文
						// 输入法的：选字时的回车是「确认这个词」，不是「搜」，
						// 不挡住的话每打一个词就会提交一次。
						if (e.key !== "Enter" || e.shiftKey) return;
						if (e.nativeEvent.isComposing) return;
						e.preventDefault();
						formRef.current?.requestSubmit();
					}}
					/* 只说格式——一句话，而且一句里可以放好几个条件。「找什么样的
					   人」由这一屏的标题去问，两处各说一半，不互相重复。 */
					placeholder="用一句话说，条件可以放好几个"
					ref={inputRef}
					value={draft}
				/>
				{/* 底栏而不是右端的一格：这块面高得多，一个贴在右边缘中间的
				    按钮会浮在一大片空白里。coss 的 `block-end` 就是给这种
				    「上面写字、下面一条动作栏」备的排法。 */}
				<InputGroupAddon align="block-end">
					{onCancel && (
						<Button
							disabled={busy}
							onClick={onCancel}
							size="sm"
							variant="ghost"
						>
							取消
						</Button>
					)}
					<Button
						aria-label="搜索"
						className="ms-auto"
						disabled={draft.trim() === ""}
						loading={busy}
						render={<button type="submit" />}
						size="icon-sm"
						variant="secondary"
					>
						<ArrowUpIcon />
					</Button>
				</InputGroupAddon>
			</InputGroup>
		</form>
	);
}
