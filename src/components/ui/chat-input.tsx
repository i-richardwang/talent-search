import { ChevronDownIcon, Loader2Icon, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";
import { Icon } from "./icon";

/*
 * 输入托盘，样式在 chat-input.css。`ChatInput` 是那一块面（可以在上沿挂一片 `tray`），
 * 里面依次放内容区（一段文字用 `ChatInputArea`，别的内容用 `ChatInputBody`，空着时的
 * 那句话用 `ChatInputPlaceholder`）和 `ChatInputBar`。动作栏左边放 `ChatInputAction`
 * （小号的文字按钮，常作菜单或弹层的触发器），右边放发送钮 `ChatInputSend`。内容区
 * 多高、发送钮什么形状跟着面的 `size` 走，零件自己不带尺寸。
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

/**
 * 会随内容长高的文本区，超过 20rem 在里面滚动。`placeholder` 是空着时的那句话，
 * `hint` 跟在它后面（例如换行的快捷键）；两者画在文本区上面的一层，读屏读的是
 * `aria-placeholder`。
 */
export function ChatInputArea({
	placeholder,
	hint,
	className,
	...props
}: Omit<ComponentProps<"textarea">, "placeholder"> & {
	placeholder: string;
	hint?: ReactNode;
}) {
	return (
		<div className="ui-chat-input-area">
			<textarea
				aria-placeholder={placeholder}
				className={cn("ui-chat-input-textarea", className)}
				placeholder=" "
				{...props}
			/>
			<ChatInputPlaceholder hint={hint}>{placeholder}</ChatInputPlaceholder>
		</div>
	);
}

/**
 * 内容区空着时的那句话，画在第一行的位置上，后面可以跟 `hint`。只是给眼睛看的一层：
 * 读屏读的是输入框自己的 `aria-placeholder` 或 `aria-label`。`ChatInputArea` 自带一个；
 * `ChatInputBody` 里由调用处在空着时放上。
 */
export function ChatInputPlaceholder({
	hint,
	children,
}: {
	hint?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div aria-hidden="true" className="ui-chat-input-placeholder">
			<span>{children}</span>
			{hint}
		</div>
	);
}

/** 不是一段文字的内容区：和文本区同样的最小高度与内边距，里面放什么由调用处定。 */
export function ChatInputBody({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("ui-chat-input-body", className)} {...props} />;
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

/**
 * 动作栏上的文字按钮：图标、一句话，`chevron` 时尾巴上一个向下的箭头，表示点开是
 * 菜单或弹层。字太长时截断，完整的话放进 `aria-label` 或 `title`。
 */
export function ChatInputAction({
	icon,
	chevron,
	children,
	className,
	type = "button",
	...props
}: ComponentProps<"button"> & { icon?: LucideIcon; chevron?: boolean }) {
	return (
		<button
			className={cn("ui-chat-input-action", className)}
			type={type}
			{...props}
		>
			{icon && <Icon icon={icon} size={14} />}
			<span className="ui-chat-input-action-label">{children}</span>
			{chevron && <Icon icon={ChevronDownIcon} size={12} />}
		</button>
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
