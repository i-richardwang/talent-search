import type { ReactNode } from "react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
	ChatInput,
	ChatInputArea,
	ChatInputBar,
	ChatInputSend,
} from "#/components/ui/chat-input";
import { Hotkey } from "#/components/ui/hotkey";
import type { QueryInput } from "#/search/spec";

export type QueryBarHandle = {
	/** 填一句话进去并聚焦，不提交：例子是起点，不是答案。 */
	fill: (text: string) => void;
	focus: () => void;
};

/**
 * AI 搜索写需求的框：首页写第一句（`large`），工作台右栏补充下一句。Enter 提交、
 * Shift+Enter 换行。middle 的占位后面跟快捷键提示：光标不在框里且给了 `focusKey` 时
 * 是那个键，否则是换行的键。
 *
 * 原话在提交成功之前不清空：提交（落一条记录）会失败，清掉就没法重试。
 */
export function QueryBar({
	onQuery,
	ref,
	placeholder,
	size = "middle",
	left,
	autoFocus = false,
	waiting = false,
	focusKey,
}: {
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	ref?: React.Ref<QueryBarHandle>;
	placeholder: string;
	size?: "middle" | "large";
	left?: ReactNode;
	autoFocus?: boolean;
	/** 上一句还在理解：可以接着写，先不能提交。 */
	waiting?: boolean;
	/** 页面上把光标放进这个框的快捷键，光标不在框里时写在占位后面。 */
	focusKey?: string;
}) {
	const [draft, setDraft] = useState("");
	// 提交成功时比对的是那一刻框里的字，读 state 会读到发起提交时的旧值
	const draftRef = useRef("");
	const [busy, setBusy] = useState(false);
	const [focused, setFocused] = useState(false);
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
			<ChatInput size={size}>
				<ChatInputArea
					aria-label="描述需求"
					onBlur={() => setFocused(false)}
					onChange={(e) => write(e.target.value)}
					onKeyDown={(e) => {
						if (e.key !== "Enter" || e.shiftKey) return;
						// 输入法选词时的回车是确认候选词，不是提交
						if (e.nativeEvent.isComposing) return;
						e.preventDefault();
						formRef.current?.requestSubmit();
					}}
					onFocus={() => setFocused(true)}
					hint={
						size === "middle" &&
						(focusKey && !focused ? (
							<span className="inline-flex items-center">
								按<Hotkey keys={focusKey} variant="borderless" />
								开始输入
							</span>
						) : (
							<span className="inline-flex items-center">
								按<Hotkey keys="shift+enter" variant="borderless" />
								换行
							</span>
						))
					}
					placeholder={placeholder}
					ref={inputRef}
					value={draft}
				/>
				<ChatInputBar
					left={left}
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
