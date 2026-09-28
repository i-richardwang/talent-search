import type { CSSProperties, ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 一个对象的几条属性，标签一栏、内容一栏。`middle` 是详情里的主属性，`small` 是一块里的
 * 附属属性（一段经历下的技能、职责）。标签栏缺省按最长的标签定宽；几块属性上下排时给同一个
 * `labelWidth`（px），内容栏才对得齐。
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

/** 一条属性：一对 `dt`/`dd`。 */
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
