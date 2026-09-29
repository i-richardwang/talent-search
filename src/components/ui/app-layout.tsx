import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { type LucideIcon, XIcon } from "lucide-react";
import {
	type ComponentProps,
	createContext,
	type ReactNode,
	use,
	useState,
} from "react";
import { cn } from "#/lib/utils";
import { ActionIcon } from "./action-icon";
import { DraggablePanel } from "./draggable-panel";
import {
	DrawerBackdrop,
	DrawerPopup,
	DrawerPortal,
	DrawerRoot,
	DrawerTitle,
} from "./drawer";
import { Icon } from "./icon";

/*
 * 应用外壳：左边 `AppNav` 落在画布上，右边 `AppContent` 是内缩的内容卡片，卡片里每一栏
 * 顶上是一条 `NavHeader`。`AppNavDrawer` 是从左边滑出、和导航栏同一块画布的一栏。
 */

/** 导航栏右缘那个 0 宽的容器：导航栏里打开的抽屉挂在这里，从导航栏的边上滑出。 */
const NavDrawerAnchor = createContext<HTMLElement | null>(null);

/** 导航栏的宽（px），默认值和 `--container-nav` 同宽。 */
export const NAV_WIDTH = { default: 280, max: 400, min: 240 } as const;

/** `navCollapsed`：导航栏收起时卡片左边也内缩，不贴着窗口边。 */
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
 * 左侧导航栏：lg 以上常驻，lg 以下不显示，内容由使用方另放进抽屉。宽和收起由使用方记住：
 * `onWidthChange` 在拖完一次后给出新宽。
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
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	return (
		<>
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
					<NavDrawerAnchor value={anchor}>{children}</NavDrawerAnchor>
				</nav>
			</DraggablePanel>
			<div className="ui-app-nav-drawer-anchor" ref={setAnchor} />
		</>
	);
}

/**
 * 导航栏顶上那一行：左边是身份链接（`render` 传路由的 `<Link>`），右边是收起导航栏的
 * 开关 `toggle`，平时藏着，指针进入导航栏或焦点落到它身上时出现。
 */
export function AppNavHeader({
	logo,
	name,
	toggle,
	render,
	...props
}: Omit<useRender.ComponentProps<"a">, "children"> & {
	logo: LucideIcon;
	name: string;
	toggle?: ReactNode;
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
			{toggle && (
				<div className="ui-app-nav-header-actions">
					<div className="ui-app-nav-toggle">{toggle}</div>
				</div>
			)}
		</div>
	);
}

/**
 * 贴着左边滑出的一栏。`title` 不给时不画顶上那一行，由内容自己出头部和关闭钮
 * （窄屏的导航抽屉：导航栏顶上那一行里有它）。
 *
 * 平时贴着窗口左边、盖一层背板。`anchored` 且打开它的地方在宽屏导航栏里时，它从导航栏
 * 的右缘滑出、盖在内容卡片上，没有背板：点别处不关，导航栏和卡片照常能用。
 */
export function AppNavDrawer({
	open,
	onClose,
	title,
	label,
	anchored = false,
	children,
}: {
	open: boolean;
	onClose: () => void;
	title?: string;
	/** 没有 `title` 时给读屏读的名字。 */
	label?: string;
	anchored?: boolean;
	children: ReactNode;
}) {
	const anchor = use(NavDrawerAnchor);
	const contained = anchored && anchor !== null;
	return (
		<DrawerRoot
			modal={!contained}
			onOpenChange={(next, details) => {
				if (next || (contained && details.reason === "outside-press")) return;
				onClose();
			}}
			open={open}
		>
			<DrawerPortal container={contained ? anchor : undefined}>
				{!contained && <DrawerBackdrop />}
				<DrawerPopup
					contained={contained}
					panelClassName="ui-app-nav-drawer"
					placement="left"
					width="var(--container-nav)"
				>
					{title ? (
						<div className="ui-app-nav-drawer-header">
							<DrawerTitle>
								<span className="ui-app-nav-drawer-title">{title}</span>
							</DrawerTitle>
							<div className="ui-app-nav-header-actions">
								<AppNavDrawerClose onClose={onClose} />
							</div>
						</div>
					) : (
						<span className="sr-only">
							<DrawerTitle>{label}</DrawerTitle>
						</span>
					)}
					<div className="ui-app-nav-drawer-body">{children}</div>
				</DrawerPopup>
			</DrawerPortal>
		</DrawerRoot>
	);
}

export function AppNavDrawerClose({ onClose }: { onClose: () => void }) {
	return (
		<ActionIcon
			aria-label="关闭"
			className="ui-app-nav-drawer-close"
			icon={XIcon}
			onClick={onClose}
			size="header"
		/>
	);
}

/** 内容卡片。它自己不滚动：卡片里的每一栏各自决定滚动归谁。 */
export function AppContent({ children }: { children: ReactNode }) {
	return (
		<div className="ui-app-content">
			<div className="ui-app-content-card">{children}</div>
		</div>
	);
}

/**
 * 首页那一屏：页头浮在顶上、不占高，问句、输入面和 `children` 排成居中的一列。
 * 放得下时输入面落在中线附近，放不下就从顶上排起。
 */
export function AppHome({
	header,
	title,
	input,
	children,
}: {
	header: ReactNode;
	title: ReactNode;
	input: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="ui-app-home">
			<div className="ui-app-home-header">{header}</div>
			<main className="ui-app-home-scroll" id="main" tabIndex={-1}>
				<div className="ui-app-home-column">
					<h1 className="ui-app-home-title">{title}</h1>
					{input}
					{children}
				</div>
			</main>
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

/** 页头里的标题，一行放不下就截断。主栏的是这一屏的 h1，侧栏的用 h2。 */
export function NavHeaderTitle({
	as: Heading = "h1",
	className,
	...props
}: ComponentProps<"h1"> & { as?: "h1" | "h2" }) {
	return (
		<Heading className={cn("ui-nav-header-title", className)} {...props} />
	);
}
