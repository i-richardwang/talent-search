"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { ActionIcon, type ActionIconProps } from "#/components/ui/action-icon";

/*
 * 复制按钮：按下把 `content` 写进剪贴板，之后一小会儿图标换成对勾。`content` 可以是函数，
 * 按下时才取值：内容还在变的时候复制的是按下那一刻的。
 */

const COPIED_MS = 2000;

export interface CopyButtonProps extends Omit<ActionIconProps, "content"> {
	content: string | (() => string);
}

/** 剪贴板接口不可用（非安全上下文）时退回选中一个临时文本框再复制。 */
async function writeClipboard(text: string) {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		const field = document.createElement("textarea");
		field.value = text;
		document.body.append(field);
		field.focus();
		field.select();
		document.execCommand("copy");
		field.remove();
	}
}

export function CopyButton({
	active,
	className,
	content,
	icon,
	onClick,
	title = "复制",
	...props
}: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
		return () => window.clearTimeout(timer);
	}, [copied]);

	return (
		<ActionIcon
			title={title}
			{...props}
			active={active || copied}
			className={className}
			icon={copied ? Check : (icon ?? Copy)}
			onClick={async (event) => {
				await writeClipboard(
					typeof content === "function" ? content() : content,
				);
				setCopied(true);
				onClick?.(event);
			}}
		/>
	);
}

/** 浮层触发器按它认出这是原生 `<button>`（见 `native-button.ts`）。 */
CopyButton.displayName = "CopyButton";
