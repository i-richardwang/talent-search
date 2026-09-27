import type { ReactNode } from "react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
	ChatInput,
	ChatInputArea,
	ChatInputBar,
	ChatInputSend,
} from "#/components/ui/chat-input";
import type { QueryInput } from "#/search/spec";

/** 外面能对这个框做的事。填入不提交：例子是起点，不是答案。 */
export type QueryBarHandle = {
	/** 填一句话进去并聚焦，光标落在末尾。不提交。 */
	fill: (text: string) => void;
	/** 把光标放进框里。工作台的「/」和空态的出路都落到这里。 */
	focus: () => void;
};

/**
 * 写需求的那个框。**全站只有这一个形状**：首页写下第一句（`large`），右栏线程底下补充
 * 下一句，两处做的是同一件事——把「我要找什么人」说成一句话。
 *
 * 一块输入托盘：文本区随内容长高，Enter 提交、Shift+Enter 换行，发送钮在面里的右下角。
 * `tray` 挂在托盘上沿，放作用于这句话之前的、点一下就能办的事。
 *
 * 提交是**异步**的，但只异步一次 INSERT 那么久：查询理解在工作台里补
 * （见 `s/$turnId/route.tsx`）。**原话在提交成功之前不清空**：这一步会失败，
 * 中途清空等于把人刚敲的东西吞了，连重试都没得重试。
 *
 * 出去的永远是 `sentence`：框里是一句话，标签就在造出它的地方打上。
 * 草稿归它自己，「提交成功才清空」这条规则因此只写这一遍。
 */
export function QueryBar({
	onQuery,
	ref,
	placeholder,
	size = "middle",
	tray,
	autoFocus = false,
	waiting = false,
}: {
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	ref?: React.Ref<QueryBarHandle>;
	placeholder: string;
	size?: "middle" | "large";
	tray?: ReactNode;
	autoFocus?: boolean;
	/** 上一句还在理解：可以接着敲，先不能提交。 */
	waiting?: boolean;
}) {
	const [draft, setDraft] = useState("");
	// 提交成功时比对的是那一刻框里的字，读 state 会读到发起提交时的旧值
	const draftRef = useRef("");
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const formRef = useRef<HTMLFormElement>(null);

	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);

	useImperativeHandle(ref, () => ({
		fill: (text) => {
			draftRef.current = text;
			setDraft(text);
			inputRef.current?.focus();
		},
		focus: () => inputRef.current?.focus(),
	}));

	const write = (text: string) => {
		draftRef.current = text;
		setDraft(text);
	};

	return (
		<form
			onSubmit={async (e) => {
				e.preventDefault();
				const q = draft.trim();
				if (!q || busy || waiting) return;
				setBusy(true);
				try {
					const ok = await onQuery({ kind: "sentence", text: q });
					// 等待期间人又改了框里的字，就不清：清掉的会是新敲的那句
					if (ok && draftRef.current.trim() === q) write("");
				} finally {
					setBusy(false);
				}
			}}
			ref={formRef}
		>
			<ChatInput size={size} tray={tray}>
				<ChatInputArea
					aria-label="描述需求"
					onChange={(e) => write(e.target.value)}
					onKeyDown={(e) => {
						if (e.key !== "Enter" || e.shiftKey) return;
						// 输入法选词时的回车是确认候选词，不是提交
						if (e.nativeEvent.isComposing) return;
						e.preventDefault();
						formRef.current?.requestSubmit();
					}}
					placeholder={placeholder}
					ref={inputRef}
					value={draft}
				/>
				<ChatInputBar
					right={
						<ChatInputSend
							aria-label="搜索"
							disabled={draft.trim() === "" || waiting}
							loading={busy}
						/>
					}
				/>
			</ChatInput>
		</form>
	);
}
