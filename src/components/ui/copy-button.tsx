"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { ActionIcon, type ActionIconProps } from "#/components/ui/action-icon";
import { cn } from "#/lib/utils";

/*
 * 复制按钮：一颗 ActionIcon，按下把 `content` 写进剪贴板，之后 2 秒图标换成对勾、
 * 按钮停在 active 态，再回到复制图标。样式在 copy-button.css。
 *
 * - `content` 可以是函数，按下时才取值：内容还在变的时候复制的是按下那一刻的。
 * - `glass` 默认开：按钮压在内容上时底下的字糊掉，不和图标抢。
 * - 剪贴板接口不可用（非安全上下文）时退回选中一个临时文本框再复制。
 * - 提示与 aria-label 默认是「复制」，调用处可以用 `title` 说清复制的是什么。
 */

const COPIED_MS = 2000;

export interface CopyButtonProps extends Omit<ActionIconProps, "content"> {
	content: string | (() => string);
	glass?: boolean;
}

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
	glass = true,
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
			className={cn(glass && "ui-copy-button-glass", className)}
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
