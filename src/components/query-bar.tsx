import { ArrowUpIcon } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { TextArea } from "#/components/ui/input";
import type { QueryInput } from "#/search/spec";

/** 外面能对这个框做的事。填入不提交：例子是起点，不是答案。 */
export type QueryBarHandle = {
	/** 填一句话进去并聚焦，光标落在末尾。不提交。 */
	fill: (text: string) => void;
	/** 把光标放进框里。工作台的「/」和空态的出路都落到这里。 */
	focus: () => void;
};

/**
 * 写查询的那个框。**全站只有这一个形状**：零态写下第一句，右栏线程底下补充下一句，
 * 两处做的是同一件事——把「我要找什么人」说成一句话——所以它们不该长成两样。
 *
 * 多行的 `TextArea` 随内容长高，发送按钮在它下面一行的右端。一句话里要放
 * 好几个条件，单行框写到一半就看不见开头了。
 *
 * 提交是**异步**的，但只异步一次 INSERT 那么久：查询理解不在这条路上，
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
	placeholder,
	autoFocus = false,
	waiting = false,
}: {
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	ref?: React.Ref<QueryBarHandle>;
	/** 框里装什么。零态问第一句，工作台问下一句。 */
	placeholder: string;
	/** 挂载即聚焦：零态整屏就这一件事。工作台上名单才是主角，不抢焦点。 */
	autoFocus?: boolean;
	/** 上一句还没整理完：可以接着敲，先不能提交——下一句要作用在它的结果上。 */
	waiting?: boolean;
}) {
	const [draft, setDraft] = useState("");
	const draftRef = useRef("");
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const formRef = useRef<HTMLFormElement>(null);

	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);

	// 光标不用手动摆：受控的 value 变长之后浏览器把插入点留在末尾，
	// 而 `focus()` 先发生，所以填完就能接着敲。
	useImperativeHandle(ref, () => ({
		fill: (text) => {
			draftRef.current = text;
			setDraft(text);
			inputRef.current?.focus();
		},
		focus: () => inputRef.current?.focus(),
	}));

	return (
		// 吃满容器：宽度由摆它的那一屏说了算——零态摆在版心里，工作台摆在右栏
		// 线程的底下——所以这里不自己再限一次宽。
		<form
			className="flex w-full flex-col gap-2"
			onSubmit={async (e) => {
				e.preventDefault();
				const q = draft.trim();
				if (!q || busy || waiting) return;
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
			<TextArea
				aria-label="搜索人才"
				autoSize={{ minRows: 2 }}
				onChange={(e) => {
					draftRef.current = e.target.value;
					setDraft(e.target.value);
				}}
				onKeyDown={(e) => {
					// 回车即搜，Shift+回车换行。`isComposing` 那一条是给中文
					// 输入法的：选字时的回车是「确认这个词」，不是「搜」，
					// 不挡住的话每打一个词就会提交一次。
					if (e.key !== "Enter" || e.shiftKey) return;
					if (e.nativeEvent.isComposing) return;
					e.preventDefault();
					formRef.current?.requestSubmit();
				}}
				placeholder={placeholder}
				ref={inputRef}
				value={draft}
			/>
			<ActionIcon
				aria-label="搜索"
				className="self-end"
				disabled={draft.trim() === "" || waiting}
				icon={ArrowUpIcon}
				loading={busy}
				render={<button type="submit" />}
				size="small"
				variant="filled"
			/>
		</form>
	);
}
