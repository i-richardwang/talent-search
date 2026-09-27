import { Loader2Icon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";
import { Icon } from "./icon";

/*
 * 输入托盘，样式在 chat-input.css。`ChatInput` 是那一块面（可以在上沿挂一片 `tray`），
 * 里面依次放 `ChatInputArea` 和 `ChatInputBar`，发送钮 `ChatInputSend` 放在动作栏右边。
 * 文本区多高、发送钮什么形状跟着面的 `size` 走，零件自己不带尺寸。
 */

export function ChatInput({
	size = "middle",
	tray,
	className,
	children,
	...props
}: ComponentProps<"div"> & {
	size?: "middle" | "large";
	/** 挂在面上沿的那一片，放点一下就能办的事。 */
	tray?: ReactNode;
}) {
	return (
		<div className={cn("ui-chat-input-root", className)} {...props}>
			{tray && <div className="ui-chat-input-tray">{tray}</div>}
			<div
				className={cn(
					"ui-chat-input",
					size === "large" && "ui-chat-input-large",
				)}
			>
				{children}
			</div>
		</div>
	);
}

/** 会随内容长高的文本区，超过 20rem 在里面滚动。 */
export function ChatInputArea({
	className,
	...props
}: ComponentProps<"textarea">) {
	return (
		<textarea className={cn("ui-chat-input-textarea", className)} {...props} />
	);
}

/** 面底下的动作栏：`left` 放附加的动作，`right` 放发送钮。 */
export function ChatInputBar({
	left,
	right,
}: {
	left?: ReactNode;
	right: ReactNode;
}) {
	return (
		<div className="ui-chat-input-bar">
			{left && <div className="ui-chat-input-bar-left">{left}</div>}
			<div className="ui-chat-input-bar-right">{right}</div>
		</div>
	);
}

/** 发送钮，默认是表单的提交钮。`loading` 时换成转圈并且按不下去。 */
export function ChatInputSend({
	loading,
	disabled,
	className,
	type = "submit",
	...props
}: Omit<ComponentProps<"button">, "children"> & { loading?: boolean }) {
	return (
		<button
			aria-busy={loading || undefined}
			className={cn("ui-chat-input-send", className)}
			disabled={disabled || loading}
			type={type}
			{...props}
		>
			{loading ? <Icon icon={Loader2Icon} size={14} spin /> : <SendGlyph />}
		</button>
	);
}

/** 实心的纸飞机，1em 见方，跟着按钮的字号。 */
function SendGlyph() {
	return (
		<svg
			aria-hidden="true"
			fill="currentColor"
			fillRule="evenodd"
			height="1em"
			viewBox="0 0 14 14"
			width="1em"
		>
			<path d="M.743 3.773c-.818-.555-.422-1.834.567-1.828l11.496.074a1 1 0 01.837 1.538l-6.189 9.689c-.532.833-1.822.47-1.842-.518L5.525 8.51a1 1 0 01.522-.9l1.263-.686a.808.808 0 00-.772-1.42l-1.263.686a1 1 0 01-1.039-.051L.743 3.773z" />
		</svg>
	);
}
