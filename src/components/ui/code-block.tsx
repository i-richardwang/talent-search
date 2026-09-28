"use client";

import { CopyButton } from "#/components/ui/copy-button";
import { Tag } from "#/components/ui/tag";

/*
 * 代码块：等宽的原文放在一块面里，不做语法着色，长行折行。复制钮和语言标签浮在块的角上，
 * 悬停或焦点落进块里才出现。首尾的空白行不显示也不复制。
 */
export function CodeBlock({
	children,
	language,
}: {
	children: string;
	/** 语言标签，写给人看的名字，如 `JSON`、`日志`。 */
	language: string;
}) {
	const text = children.trim();
	return (
		<div className="ui-code-block">
			<div className="ui-code-block-actions">
				<CopyButton
					className="ui-code-block-copy"
					content={text}
					size="header"
				/>
			</div>
			<Tag className="ui-code-block-language">{language}</Tag>
			<div className="ui-code-block-body">
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
