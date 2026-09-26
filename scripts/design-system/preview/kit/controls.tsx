import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 试用区上方的一排控件。每个控件一格，格底对齐：带标签的格标签在上、控件在下；
 * 不带标签的格（复选框自己带字）高度与中档控件相同，文字和旁边控件的中线对齐。
 */

/** 一排控件：换行排开，格底对齐。 */
export function Controls({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-end gap-x-4 gap-y-3 text-fg-secondary text-xs",
				className,
			)}
		>
			{children}
		</div>
	);
}

/**
 * 一格控件。给了 `htmlFor` 标签就是指向那个输入框的 `<label>`；没给时整格是一个
 * `<fieldset>`，标签是它的 `<legend>`，里面的控件（分段选择、单选组）不再另起同样的
 * 名字。不给标签的格只管对齐。`className` 只放这一格的宽度。
 */
export function Control({
	children,
	className,
	htmlFor,
	label,
}: {
	children: ReactNode;
	className?: string;
	htmlFor?: string;
	label?: string;
}) {
	if (!label)
		return (
			<div
				className={cn("flex h-(--input-height-middle) items-center", className)}
			>
				{children}
			</div>
		);
	if (htmlFor)
		return (
			<div className={cn("flex flex-col gap-1.5", className)}>
				<label htmlFor={htmlFor}>{label}</label>
				{children}
			</div>
		);
	return (
		<fieldset className={cn("flex min-w-0 flex-col", className)}>
			<legend className="mb-1.5">{label}</legend>
			{children}
		</fieldset>
	);
}
