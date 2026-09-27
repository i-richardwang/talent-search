import { ArrowUpIcon, Loader2Icon } from "lucide-react";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "#/lib/utils";
import { Icon } from "./icon";

/*
 * 输入托盘，样式在 chat-input.css。`ChatInput` 是那一块面（可以在上沿挂一片 `tray`），
 * 里面依次放 `ChatInputArea` 和 `ChatInputBar`，发送钮 `ChatInputSend` 放在动作栏右边。
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

/** 会随内容长高的文本区，`rows` 是空着时至少几行，超过 20rem 在里面滚动。 */
export function ChatInputArea({
	rows = 1,
	className,
	style,
	...props
}: ComponentProps<"textarea">) {
	return (
		<textarea
			className={cn("ui-chat-input-textarea", className)}
			style={{ "--chat-input-rows": rows, ...style } as CSSProperties}
			{...props}
		/>
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

/** 圆形的发送钮，默认是表单的提交钮。`loading` 时换成转圈并且按不下去。 */
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
			<Icon
				icon={loading ? Loader2Icon : ArrowUpIcon}
				size={16}
				spin={loading}
			/>
		</button>
	);
}
