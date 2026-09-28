import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Icon } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/*
 * 筛选钮，样式在 filter-button.css：名单上方那一排里的一维，点开是这一维的下拉菜单。
 * 24px 高的胶囊、12px 字，平时三级灰；悬停，或者这一维选了东西（`active`）时，字换成
 * 正文色、铺二级填充。字后面跟一个 12px 的下箭头。
 */
export function FilterButton({
	active = false,
	children,
	className,
	...props
}: ComponentProps<"button"> & {
	/** 这一维选了东西。 */
	active?: boolean;
}) {
	return (
		<button
			className={cn("ui-filter-button", className)}
			data-active={active || undefined}
			type="button"
			{...props}
		>
			{children}
			<Icon icon={ChevronDownIcon} size={12} />
		</button>
	);
}
FilterButton.displayName = "FilterButton";
