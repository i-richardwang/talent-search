import { ChevronDownIcon, Loader2Icon, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";
import { Icon } from "./icon";

/*
 * 输入托盘：`ChatInput` 是那一块面，里面依次放内容区（`ChatInputArea` 或 `ChatInputBody`）
 * 和 `ChatInputBar`。内容区多高、发送钮什么形状跟着面的 `size` 走，零件自己不带尺寸。
 */

export function ChatInput({
	size = "middle",
	className,
	...props
}: ComponentProps<"div"> & { size?: "middle" | "large" }) {
	return (
		<div
			className={cn(
				"ui-chat-input",
				size === "large" && "ui-chat-input-large",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * 会随内容长高的文本区。`hint` 跟在占位那句话后面（例如换行的快捷键），所以占位不用原生的
 * placeholder，而是画在文本区上面的一层，读屏读的是 `aria-placeholder`。
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
 * 内容区空着时的那句话，只给眼睛看：读屏读的是输入框自己的 `aria-placeholder` 或
 * `aria-label`。`ChatInputArea` 自带一个；`ChatInputBody` 里由调用处在空着时放上。
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

/** 不是一段文字的内容区，和文本区同样的最小高度。 */
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
 * 动作栏上的文字按钮，`chevron` 表示点开是菜单或弹层。`value`（缺省）写着这一项当前取的
 * 值，字太长时截断，完整的话放进 `aria-label` 或 `title`；`mode` 是动作栏左端切换搜索方式
 * 的那一个。
 */
export function ChatInputAction({
	icon,
	chevron,
	variant = "value",
	children,
	className,
	type = "button",
	...props
}: ComponentProps<"button"> & {
	icon?: LucideIcon;
	chevron?: boolean;
	variant?: "value" | "mode";
}) {
	return (
		<button
			className={cn(
				"ui-chat-input-action",
				variant === "mode" && "ui-chat-input-action-mode",
				className,
			)}
			type={type}
			{...props}
		>
			{icon && <Icon icon={icon} size={variant === "mode" ? 14 : 12} />}
			<span className="ui-chat-input-action-label">{children}</span>
			{chevron && <Icon icon={ChevronDownIcon} size={12} />}
		</button>
	);
}
ChatInputAction.displayName = "ChatInputAction";

/** 发送钮，默认是表单的提交钮。 */
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
