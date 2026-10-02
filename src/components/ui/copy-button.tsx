"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { ActionIcon, type ActionIconProps } from "#/components/ui/action-icon";
import { toast } from "#/components/ui/toast";

/*
 * 复制按钮：按下把 `content` 写进剪贴板，之后一小会儿图标换成对勾。`content` 可以是函数，
 * 按下时才取值：内容还在变的时候复制的是按下那一刻的。
 */

const COPIED_MS = 2000;

interface CopyButtonProps extends Omit<ActionIconProps, "content"> {
	content: string | (() => string);
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
				try {
					await navigator.clipboard.writeText(
						typeof content === "function" ? content() : content,
					);
				} catch {
					toast.error("复制失败，请选中文字后手动复制");
					return;
				}
				setCopied(true);
				onClick?.(event);
			}}
		/>
	);
}

/** 浮层触发器按它认出这是原生 `<button>`（见 `native-button.ts`）。 */
CopyButton.displayName = "CopyButton";
