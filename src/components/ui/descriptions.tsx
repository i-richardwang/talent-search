import type { CSSProperties, ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 一个对象的几条属性，样式在 descriptions.css。标签一栏、内容一栏，两栏各自对齐；
 * 标签次要色，内容正文色。
 *
 * - `middle` 是详情里的主属性：标签 12px、内容 13px，一行至少 28px 高，行距 4px，两栏隔 16px。
 * - `small` 是一块里的附属属性（一段经历下的技能、职责）：标签与内容都是 12px，跟着那一块的小字。
 *
 * 标签栏缺省按最长的标签定宽；`labelWidth` 给了就定成那个宽度（px），几块属性上下排时
 * 用同一个宽度，内容栏才对得齐。
 */

export type DescriptionsSize = "small" | "middle";

export function Descriptions({
	size = "middle",
	labelWidth,
	className,
	children,
}: {
	size?: DescriptionsSize;
	labelWidth?: number;
	className?: string;
	children: ReactNode;
}) {
	return (
		<dl
			className={cn("ui-descriptions", `ui-descriptions-${size}`, className)}
			style={
				labelWidth === undefined
					? undefined
					: ({
							"--ui-descriptions-label-width": `${labelWidth}px`,
						} as CSSProperties)
			}
		>
			{children}
		</dl>
	);
}

/** 一条属性：一对 `dt`/`dd`，两栏由外面的 `Descriptions` 对齐。 */
export function DescriptionsItem({
	label,
	children,
}: {
	label: ReactNode;
	children: ReactNode;
}) {
	return (
		<>
			<dt className="ui-descriptions-label">{label}</dt>
			<dd className="ui-descriptions-value">{children}</dd>
		</>
	);
}
