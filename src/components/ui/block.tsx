import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "#/lib/utils";
import { Flexbox, type FlexboxProps } from "./flex";

/*
 * 一块面，就是一个带面样式的 Flexbox（默认纵向），样式在 block.css。两种面：filled 是
 * fill-tertiary 的底，outlined 是 container 底加一圈 border-secondary。`clickable` 加手形，
 * 悬停时描边加深，只用在描边面上；`shadow` 加一层投影；`selected` 用主色一侧最浅的底和边。
 * 整块可点时，块里那条链接用 `BlockLink`。
 */

interface BlockProps extends FlexboxProps {
	clickable?: boolean;
	selected?: boolean;
	shadow?: boolean;
	variant?: "filled" | "outlined";
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
				clickable && "ui-block-clickable",
				shadow && "ui-block-shadow",
				selected && "ui-block-selected",
				className,
			)}
			{...rest}
		/>
	);
}

/**
 * 整块可点的那条链接，放在 `clickable` 的 Block 里：链接的 `::after` 铺满整块当点击面，
 * 键盘焦点的外框画在整块的轮廓上。`render` 传路由的 `<Link>` 或 `<a>`，中键、右键
 * 照常。覆盖层之内不放别的动作，选择框放在块外。
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
