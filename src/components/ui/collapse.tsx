"use client";

import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Icon, type IconProps } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/*
 * 带标题的一组内容，样式在 collapse.css。头上一行：可选的图标与标题（16px 中粗，行高
 * 28px），标题下可带一行 12px 的说明，行尾 `extra` 放这一组的动作；头下是内容。
 * 头与内容各留上下 12px、左右 16px。
 *
 * 三种面：filled 外层铺 fill-quaternary（深色侧是 layout），内容放在里面一块 container
 * 底、border-secondary 描边、8px 圆角的面上，这块面左右和底边向里收 3px，浅色侧带
 * 一层贴边投影；outlined 整组一圈描边、container 底，展开时头下一条线；borderless
 * 没有底，头和内容左右不留白。
 *
 * `collapsible` 时标题连同行首的箭头是开关（`extra` 不是），收着时箭头朝右；
 * 开合用 `open` 受控或 `defaultOpen` 自管。不给 `collapsible` 时内容一直在。
 */

export interface CollapseProps {
	children?: ReactNode;
	className?: string;
	/** 头与内容两层的类名，给调用处改留白用，例如内容是一张贴边的表。 */
	classNames?: { body?: string; header?: string };
	collapsible?: boolean;
	defaultOpen?: boolean;
	desc?: ReactNode;
	extra?: ReactNode;
	icon?: IconProps["icon"];
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
	title?: ReactNode;
	variant?: "filled" | "outlined" | "borderless";
}

export function Collapse({
	children,
	className,
	classNames,
	collapsible = false,
	defaultOpen = true,
	desc,
	extra,
	icon,
	onOpenChange,
	open,
	title,
	variant = "filled",
}: CollapseProps) {
	// 自管的开合状态；给了 `open` 时听外面的。交给 Base UI 的总是受控值，
	// 于是 `collapsible` 在运行中切换时不会从受控变成非受控。
	const [ownOpen, setOwnOpen] = useState(defaultOpen);
	const shown = !collapsible || (open ?? ownOpen);
	const heading = (
		<div className="ui-collapse-heading">
			<div className="ui-collapse-title">
				{icon && <Icon icon={icon} size={{ size: "1.1em" }} />}
				{title}
			</div>
			{desc && <div className="ui-collapse-desc">{desc}</div>}
		</div>
	);
	return (
		<BaseCollapsible.Root
			className={cn("ui-collapse", `ui-collapse-${variant}`, className)}
			onOpenChange={(next) => {
				if (!collapsible) return;
				setOwnOpen(next);
				onOpenChange?.(next);
			}}
			open={shown}
		>
			<div className={cn("ui-collapse-header", classNames?.header)}>
				{collapsible ? (
					<BaseCollapsible.Trigger className="ui-collapse-trigger">
						<ChevronDown aria-hidden className="ui-collapse-arrow" size={16} />
						{heading}
					</BaseCollapsible.Trigger>
				) : (
					heading
				)}
				{extra && <div className="ui-collapse-extra">{extra}</div>}
			</div>
			<BaseCollapsible.Panel className="ui-collapse-panel">
				<div className={cn("ui-collapse-body", classNames?.body)}>
					{children}
				</div>
			</BaseCollapsible.Panel>
		</BaseCollapsible.Root>
	);
}
