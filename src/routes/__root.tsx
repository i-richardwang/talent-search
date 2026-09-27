import harmonySansScCss from "@lobehub/webfont-harmony-sans-sc-mini/css/index.css?url";
import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { Toaster } from "#/components/ui/toast";
import { recentSearches, understandingOn } from "#/server/functions";
import appCss from "../styles.css?url";
import { AppShell } from "./-components/app-shell";
import { PageNotFound } from "./-components/not-found";
import { NAV_COOKIE, navPrefsOf } from "./-lib/nav-prefs";
import { RECENT_FIRST_PAGE } from "./-lib/recent";

// 首帧绘制前按系统深浅色切换 `dark` 类，深色令牌不会先以浅色闪一下。
const SYNC_COLOR_MODE = `(()=>{try{const m=matchMedia("(prefers-color-scheme: dark)"),a=e=>{const d=document.documentElement;d.classList.toggle("dark",e.matches);d.style.colorScheme=e.matches?"dark":"light"};a(m);m.addEventListener("change",a)}catch(e){}})()`;

/**
 * 导航栏记住的样子：服务端直出时读请求带来的 cookie，浏览器里（换屏、重取时）读
 * `document.cookie`，两边读的是同一个 cookie。
 */
const readNavPrefs = createIsomorphicFn()
	.server(() => navPrefsOf(getCookie(NAV_COOKIE)))
	.client(() => {
		const entry = document.cookie
			.split("; ")
			.find((part) => part.startsWith(`${NAV_COOKIE}=`));
		return navPrefsOf(
			entry && decodeURIComponent(entry.slice(NAV_COOKIE.length + 1)),
		);
	});

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "人才搜索" },
		],
		links: [
			{ rel: "stylesheet", href: harmonySansScCss },
			{ rel: "stylesheet", href: appCss },
		],
	}),
	// 最近搜索取不到时是 null：导航栏和首页各自说取不到并给重试，不当成还没有记录。
	loader: async () => {
		const [recent, understanding] = await Promise.all([
			recentSearches({ data: { page: 1, size: RECENT_FIRST_PAGE } }).then(
				(page) => page,
				() => null,
			),
			understandingOn(),
		]);
		return { nav: readNavPrefs(), recent, understanding };
	},
	shellComponent: RootDocument,
	component: RootComponent,
	notFoundComponent: PageNotFound,
});

function RootComponent() {
	return (
		<AppShell>
			<Outlet />
		</AppShell>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		// 头部脚本在水合前就改了 <html> 的类和 colorScheme，服务端输出与之不同是预期内的。
		<html lang="zh-CN" suppressHydrationWarning>
			<head>
				<HeadContent />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: 常量脚本，无外部输入 */}
				<script dangerouslySetInnerHTML={{ __html: SYNC_COLOR_MODE }} />
			</head>
			<body className="bg-layout text-fg">
				{children}
				<Toaster />
				<Scripts />
			</body>
		</html>
	);
}
