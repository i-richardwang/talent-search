import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Icon } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/* 筛选钮：名单上方那一排里的一维，点开是这一维的下拉菜单。 */
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

/** 浮层触发器按它认出这是原生 `<button>`（见 `native-button.ts`）。 */
FilterButton.displayName = "FilterButton";
