import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";
import { DraggablePanel } from "./draggable-panel";
import { Icon } from "./icon";

/*
 * 应用外壳，样式在 app-layout.css。`AppLayout` 是整屏那一行：左边 `AppNav` 落在画布上，
 * 右边 `AppContent` 是内缩的内容卡片，每一屏的内容都画在卡片里。卡片里每一栏顶上是
 * 一条 `NavHeader`。
 */

/** 导航栏的宽（px）：默认 280，拖动夹在 240–400。默认值和 `--container-nav` 同宽。 */
export const NAV_WIDTH = { default: 280, max: 400, min: 240 } as const;

/** `navCollapsed`：导航栏收起时卡片左边也内缩 8px，不贴着窗口边。 */
export function AppLayout({
	navCollapsed = false,
	className,
	...props
}: ComponentProps<"div"> & { navCollapsed?: boolean }) {
	return (
		<div
			className={cn("ui-app-layout", className)}
			data-nav-collapsed={navCollapsed || undefined}
			{...props}
		/>
	);
}

/**
 * 左侧导航栏：lg 以上常驻，lg 以下不渲染出来，内容由使用方另放进抽屉。
 * 右边缘可以拖动调宽（`NAV_WIDTH`），不画线；`expand` 为假时宽度动画到 0。
 * 宽和收起由使用方记住：`onWidthChange` 在拖完一次后给出新宽。
 */
export function AppNav({
	width,
	onWidthChange,
	expand = true,
	onExpandChange,
	className,
	children,
	...props
}: ComponentProps<"nav"> & {
	width?: number;
	onWidthChange?: (width: number) => void;
	expand?: boolean;
	onExpandChange?: (expand: boolean) => void;
}) {
	return (
		<DraggablePanel
			as="div"
			className="ui-app-nav"
			classNames={{ content: "ui-app-nav-content" }}
			defaultSize={NAV_WIDTH.default}
			expand={expand}
			maxWidth={NAV_WIDTH.max}
			minWidth={NAV_WIDTH.min}
			onExpandChange={onExpandChange}
			onSizeChange={onWidthChange}
			placement="left"
			showBorder={false}
			size={width}
		>
			<nav className={cn("ui-app-nav-inner", className)} {...props}>
				{children}
			</nav>
		</DraggablePanel>
	);
}

/**
 * 导航栏顶上那一行：左边是身份，一条链接（`render` 传路由的 `<Link>`），
 * 右边先是 `toggle`（收起导航栏的开关），再是 `right` 放这一栏的动作。
 * 开关平时收成 0 宽、不可见，指针进入导航栏或键盘焦点落到它身上时展开到 32px。
 */
export function AppNavHeader({
	logo,
	name,
	toggle,
	right,
	render,
	...props
}: Omit<useRender.ComponentProps<"a">, "children"> & {
	logo: LucideIcon;
	name: string;
	toggle?: ReactNode;
	right?: ReactNode;
}) {
	const brand = useRender({
		defaultTagName: "a",
		props: mergeProps<"a">(props, {
			className: "ui-app-nav-brand",
			children: (
				<>
					<span className="ui-app-nav-brand-logo">
						<Icon icon={logo} size={16} />
					</span>
					<span className="ui-app-nav-brand-name">{name}</span>
				</>
			),
		}),
		render,
	});
	return (
		<div className="ui-app-nav-header">
			{brand}
			{(toggle || right) && (
				<div className="ui-app-nav-header-actions">
					{toggle && <div className="ui-app-nav-toggle">{toggle}</div>}
					{right}
				</div>
			)}
		</div>
	);
}

/** 内容卡片。它自己不滚动：卡片里的每一栏各自决定滚动归谁。 */
export function AppContent({
	className,
	children,
	...props
}: ComponentProps<"div">) {
	return (
		<div className="ui-app-content">
			<div className={cn("ui-app-content-card", className)} {...props}>
				{children}
			</div>
		</div>
	);
}

/** 一栏顶上的页头：`left` 靠左、`right` 靠右，`children` 占中间剩下的宽。 */
export function NavHeader({
	left,
	right,
	children,
	className,
	...props
}: Omit<ComponentProps<"header">, "children"> & {
	left?: ReactNode;
	right?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<header className={cn("ui-nav-header", className)} {...props}>
			<div className="ui-nav-header-left">{left}</div>
			{children && <div className="ui-nav-header-center">{children}</div>}
			{right && <div className="ui-nav-header-right">{right}</div>}
		</header>
	);
}

/** 页头里的标题：正文字号中粗，一行放不下就截断。主栏的是这一屏的 h1，侧栏的用 h2。 */
export function NavHeaderTitle({
	as: Heading = "h1",
	className,
	...props
}: ComponentProps<"h1"> & { as?: "h1" | "h2" }) {
	return (
		<Heading className={cn("ui-nav-header-title", className)} {...props} />
	);
}
