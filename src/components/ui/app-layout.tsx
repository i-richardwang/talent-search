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
 * 应用外壳，样式在 app-layout.css。`AppLayout` 是整屏那一行：左边 `AppNav` 落在画布上，
 * 右边 `AppContent` 是内缩的内容卡片，每一屏的内容都画在卡片里。卡片里每一栏顶上是
 * 一条 `NavHeader`。`AppNavDrawer` 是从左边滑出、和导航栏同一块画布的一栏：窄屏上的
 * 导航，和导航里「更多」打开的全部记录。
 */

/** 导航栏右缘那个 0 宽的容器：导航栏里打开的抽屉挂在这里，从导航栏的边上滑出。 */
const NavDrawerAnchor = createContext<HTMLElement | null>(null);

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
 * 紧挨着它的右缘是一个 0 宽的容器，栏里 `anchored` 的 `AppNavDrawer` 挂在那里。
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

/**
 * 贴着左边滑出的一栏，和导航栏同一块画布：layout 底、两侧一根 border-secondary 的线、
 * 向右一层很浅的影，不圆角。顶上一行左边是 `title`（14px 半粗），右边是 `action` 和
 * 关闭钮（28px 的图标按钮）；`title` 不给时这一行不画，由内容自己出头部和关闭钮
 * （窄屏的导航抽屉：导航栏顶上那一行里有它）。下面的正文自己滚动。
 *
 * 平时贴着窗口左边、盖一层背板，按 Esc 或点背板关闭。`anchored` 且打开它的地方在宽屏
 * 导航栏里时，它从导航栏的右缘滑出、盖在内容卡片上，没有背板：点别处不关，导航栏
 * 和卡片照常能用，按 Esc 或关闭钮关闭。
 */
export function AppNavDrawer({
	open,
	onClose,
	title,
	label,
	action,
	anchored = false,
	width = "var(--container-nav)",
	children,
}: {
	open: boolean;
	onClose: () => void;
	/** 顶上一行的标题。 */
	title?: string;
	/** 没有 `title` 时给读屏念的名字。 */
	label?: string;
	action?: ReactNode;
	anchored?: boolean;
	width?: number | string;
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
					width={width}
				>
					{title ? (
						<div className="ui-app-nav-drawer-header">
							<DrawerTitle>
								<span className="ui-app-nav-drawer-title">{title}</span>
							</DrawerTitle>
							<div className="ui-app-nav-header-actions">
								{action}
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

/** 抽屉的关闭钮：页头那一档的图标按钮（28px，图标 16px），往行尾多伸 2px。 */
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

/**
 * 首页那一屏：卡片里铺一层比卡片暗半档的底（深色一侧自上而下由卡片色过渡过去），
 * 页头浮在顶上、不占高。正文是居中的一列：标题（一句问句，22px 半粗，最多两行）、
 * 输入面、下面接着的内容（`children`），彼此隔 24px，整页在卡片宽的一层上原生滚动。
 * 放得下时这一列上下居中，底下垫着一行问句加一段间隔的高，输入面因此落在中线附近；
 * 放不下就从顶上排起。下面的内容在首帧就定下了高度，数据到了不挪位。
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
