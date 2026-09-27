import { useLocation, useMatches } from "@tanstack/react-router";
import {
	type ComponentType,
	type ReactNode,
	useCallback,
	useEffect,
	useState,
} from "react";
import {
	AppContent,
	AppLayout,
	AppNav,
	NAV_WIDTH,
} from "#/components/ui/app-layout";
import { Button } from "#/components/ui/button";
import {
	DrawerBackdrop,
	DrawerPopup,
	DrawerPortal,
	DrawerRoot,
	DrawerTitle,
} from "#/components/ui/drawer";
import { useStoredFlag, useStoredWidth } from "../-lib/stored";
import { HomeNav } from "./home-nav";
import { InDrawer, NavControlContext, useNavHotkey } from "./nav-control";

declare module "@tanstack/react-router" {
	interface StaticDataRouteOption {
		/** 这一屏左侧导航栏里放什么；不给就是首页那一套（`HomeNav`）。 */
		nav?: ComponentType;
	}
}

/**
 * 每一屏共用的外壳：左侧导航落在画布上，右边一张内容卡片装这一屏。
 *
 * 导航栏里放什么由最深那一层路由的 `staticData.nav` 决定：搜索结果页放筛选，其余各屏
 * 是首页那一套（新搜索、最近搜索、管理页）。外壳只挂一次，换屏时导航栏不重挂。
 *
 * lg 以上导航栏可以拖动调宽、可以收起（顶上的开关或 ⌘/Ctrl + [），宽和收起记在这台
 * 浏览器里。lg 以下导航栏不常驻，同一份内容收进左边的抽屉，由页头左端的开关打开；
 * 换屏就收起。
 */
export function AppShell({ children }: { children: ReactNode }) {
	const Nav =
		useMatches({
			select: (matches) =>
				matches.reduce<ComponentType | undefined>(
					(nav, m) => m.staticData.nav ?? nav,
					undefined,
				),
		}) ?? HomeNav;
	const [open, setOpen] = useState(false);
	const { pathname } = useLocation();
	// biome-ignore lint/correctness/useExhaustiveDependencies: 换屏就收起抽屉
	useEffect(() => setOpen(false), [pathname]);

	const [collapsed, setCollapsed] = useStoredFlag("nav-collapsed", false);
	const [width, setWidth] = useStoredWidth("nav-width", {
		fallback: NAV_WIDTH.default,
		max: NAV_WIDTH.max,
		min: NAV_WIDTH.min,
	});
	const toggle = useCallback(
		() => setCollapsed(!collapsed),
		[collapsed, setCollapsed],
	);

	useNavHotkey(toggle);

	return (
		<NavControlContext
			value={{ expanded: !collapsed, openDrawer: () => setOpen(true), toggle }}
		>
			<AppLayout navCollapsed={collapsed}>
				<div className="fixed top-2 left-2 z-escape not-focus-within:sr-only">
					<Button render={<a href="#main" />} size="small">
						跳到正文
					</Button>
				</div>
				<AppNav
					aria-label="导航"
					expand={!collapsed}
					onExpandChange={(next) => setCollapsed(!next)}
					onWidthChange={setWidth}
					width={width}
				>
					<Nav />
				</AppNav>
				<AppContent>{children}</AppContent>
			</AppLayout>
			<DrawerRoot onOpenChange={setOpen} open={open}>
				<DrawerPortal>
					<DrawerBackdrop />
					<DrawerPopup placement="left" width="var(--container-nav)">
						<span className="sr-only">
							<DrawerTitle>导航</DrawerTitle>
						</span>
						<nav aria-label="导航" className="flex h-full flex-col">
							<InDrawer value>
								<Nav />
							</InDrawer>
						</nav>
					</DrawerPopup>
				</DrawerPortal>
			</DrawerRoot>
		</NavControlContext>
	);
}
