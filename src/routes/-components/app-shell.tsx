import { useLoaderData, useLocation } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
	AppContent,
	AppLayout,
	AppNav,
	AppNavDrawer,
} from "#/components/ui/app-layout";
import { Button } from "#/components/ui/button";
import { type NavPrefs, writeNavPrefs } from "../-lib/nav-prefs";
import { AllRecentsDrawer } from "./all-recents";
import { NavContent } from "./nav-content";
import {
	InDrawer,
	NavControlContext,
	useNavDocked,
	useNavHotkey,
} from "./nav-control";

/**
 * 每一屏共用的外壳：左侧导航落在画布上，右边一张内容卡片装这一屏。外壳只挂一次，
 * 换屏时导航栏不重挂。导航栏记住的样子由根路由的 loader 从 cookie 读出（`nav-prefs.ts`）。
 * lg 以下同一份导航内容收进左边的抽屉。全部搜索记录的抽屉只在这里画一个；
 * 换屏时两个抽屉都关上。
 */
export function AppShell({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [allRecents, setAllRecents] = useState(false);
	const docked = useNavDocked();
	const { pathname } = useLocation();
	// biome-ignore lint/correctness/useExhaustiveDependencies: 换屏就收起抽屉
	useEffect(() => {
		setOpen(false);
		setAllRecents(false);
	}, [pathname]);

	const { nav } = useLoaderData({ from: "__root__" });
	const [prefs, setPrefsState] = useState(nav);
	const setPrefs = useCallback(
		(patch: Partial<NavPrefs>) =>
			setPrefsState((current) => ({ ...current, ...patch })),
		[],
	);
	// 改过就写回 cookie；首帧写回的是刚读出来的同一份
	useEffect(() => writeNavPrefs(prefs), [prefs]);
	const toggle = useCallback(
		() => setPrefs({ collapsed: !prefs.collapsed }),
		[prefs.collapsed, setPrefs],
	);
	const closeDrawer = useCallback(() => setOpen(false), []);
	const openAllRecents = useCallback(() => {
		setOpen(false);
		setAllRecents(true);
	}, []);

	useNavHotkey(toggle);

	return (
		<NavControlContext
			value={{
				expanded: !prefs.collapsed,
				openAllRecents,
				openDrawer: () => setOpen(true),
				prefs,
				setPrefs,
				toggle,
			}}
		>
			<AppLayout navCollapsed={prefs.collapsed}>
				<div className="fixed top-2 left-2 z-escape not-focus-within:sr-only">
					<Button render={<a href="#main" />} size="small">
						跳到正文
					</Button>
				</div>
				<AppNav
					aria-label="导航"
					expand={!prefs.collapsed}
					onExpandChange={(next) => setPrefs({ collapsed: !next })}
					onWidthChange={(width) => setPrefs({ width: Math.round(width) })}
					width={prefs.width}
				>
					<NavContent />
					<AllRecentsDrawer
						anchored={docked}
						onClose={() => setAllRecents(false)}
						open={allRecents}
					/>
				</AppNav>
				<AppContent>{children}</AppContent>
			</AppLayout>
			<AppNavDrawer label="导航" onClose={closeDrawer} open={open}>
				<nav aria-label="导航" className="flex h-full flex-col">
					<InDrawer value={closeDrawer}>
						<NavContent />
					</InDrawer>
				</nav>
			</AppNavDrawer>
		</NavControlContext>
	);
}
