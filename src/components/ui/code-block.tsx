"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { CopyButton } from "#/components/ui/copy-button";
import { Tag } from "#/components/ui/tag";
import { cn } from "#/lib/utils";

/*
 * 代码块：等宽 12px 的原文放在一块面里，不做语法着色。样式在 code-block.css。
 *
 * - `variant`：filled 是四级填充的底（默认），outlined 是容器底加一圈次级边，
 *   borderless 没有底也没有内边距，放进别的面里用。
 * - 没有 `title` 时，复制钮浮在右上角、`language` 的标签浮在右下角，都在指针
 *   悬停或焦点落进块里时才出现；没有悬停的设备上常显。
 * - 给了 `title` 就有一条头部：左边是标题，右边是复制钮，正文在头部下面。
 * - `wrap` 让长行折行，不给时长行横向滚动。`maxHeight` 限的是正文的高度，
 *   超出在正文里滚动，复制钮和标签留在原处。
 * - 首尾的空白行不显示也不复制；每一行是一个块，行与行之间隔 4px。
 */

type CodeBlockVariant = "filled" | "outlined" | "borderless";

export interface CodeBlockProps
	extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "title"> {
	children: string;
	/** 右上角（有头部时在头部右端）的复制钮，默认有。 */
	copyable?: boolean;
	/** 右下角的语言标签，写给人看的名字，如 `JSON`、`日志`。 */
	language?: string;
	/** 正文的最大高度，超出在正文里滚动。 */
	maxHeight?: CSSProperties["maxHeight"];
	/** 头部左边的标题。 */
	title?: ReactNode;
	variant?: CodeBlockVariant;
	/** 长行折行。 */
	wrap?: boolean;
}

export function CodeBlock({
	children,
	className,
	copyable = true,
	language,
	maxHeight,
	title,
	variant = "filled",
	wrap = false,
	...props
}: CodeBlockProps) {
	const text = children.trim();
	const hasHeader = title !== undefined && title !== null;
	const copy = copyable ? (
		<CopyButton content={text} size={hasHeader ? "small" : "header"} />
	) : null;

	return (
		<div
			{...props}
			className={cn(
				"ui-code-block",
				`ui-code-block-${variant}`,
				wrap ? "ui-code-block-wrap" : "ui-code-block-nowrap",
				className,
			)}
		>
			{hasHeader ? (
				<div className="ui-code-block-header">
					<div className="ui-code-block-title">{title}</div>
					{copy && <div className="ui-code-block-header-actions">{copy}</div>}
				</div>
			) : (
				<>
					{copy && <div className="ui-code-block-actions">{copy}</div>}
					{language && <Tag className="ui-code-block-language">{language}</Tag>}
				</>
			)}
			<div className="ui-code-block-body" style={{ maxHeight }}>
				<pre className="ui-code-block-pre">
					<code className="ui-code-block-code">
						{text.split("\n").map((line, index) => (
							// 行没有别的身份：同一份原文里第几行就是它的键。
							// biome-ignore lint/suspicious/noArrayIndexKey: 见上
							<span className="ui-code-block-line" key={index}>
								{line}
							</span>
						))}
					</code>
				</pre>
			</div>
		</div>
	);
}
