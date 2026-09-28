import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "#/lib/utils";
import { Flexbox, type FlexboxProps } from "./flex";

/* 一块面：带面样式的 Flexbox。整块可点时，块里那条链接用 `BlockLink`。 */

interface BlockProps extends FlexboxProps {
	clickable?: boolean;
	selected?: boolean;
	shadow?: boolean;
	variant?: "filled" | "outlined" | "borderless";
}

export function Block({
	className,
	variant = "filled",
	shadow,
	clickable,
	selected,
	...rest
}: BlockProps) {
	return (
		<Flexbox
			className={cn(
				"ui-block",
				`ui-block-${variant}`,
				clickable && ["ui-block-clickable", `ui-block-clickable-${variant}`],
				shadow && "ui-block-shadow",
				selected && "ui-block-selected",
				className,
			)}
			{...rest}
		/>
	);
}

/**
 * 整块可点的那条链接，放在 `clickable` 的 Block 里，`render` 传路由的 `<Link>` 或 `<a>`。
 * 覆盖层之内不放别的动作，选择框放在块外。
 */
export function BlockLink({
	className,
	render,
	...props
}: useRender.ComponentProps<"a">) {
	return useRender({
		defaultTagName: "a",
		props: mergeProps<"a">(props, {
			className: cn("ui-block-link", className),
		}),
		render,
	});
}
