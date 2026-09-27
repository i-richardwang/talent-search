import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 一个对象的几条属性，样式在 descriptions.css。标签一栏、内容一栏，两栏各自对齐；
 * 标签次要色，内容正文色，字号相同。small 是一块里的附属属性（一段经历下的技能、职责）。
 */

export type DescriptionsSize = "small" | "middle";

export function Descriptions({
	size = "middle",
	className,
	children,
}: {
	size?: DescriptionsSize;
	className?: string;
	children: ReactNode;
}) {
	return (
		<dl className={cn("ui-descriptions", `ui-descriptions-${size}`, className)}>
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
