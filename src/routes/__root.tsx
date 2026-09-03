import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TooltipProvider } from "#/components/ui/tooltip";
import { recentSearches } from "#/server/functions";
import appCss from "../styles.css?url";
import { AppHeader } from "./-components/app-header";
import { DeadEnd } from "./-components/dead-end";
import { PageFrame } from "./-components/page-frame";

/**
 * 把系统深浅色偏好写成 <html> 上的 `dark` 类，并跟着系统切换实时更新。
 *
 * 这段脚本是**唯一**的深色开关，不是锦上添花：coss 的深色令牌全部定义在
 * `.dark` 这个类选择器下（见 styles.css），没有 `light-dark()` 那种由
 * `color-scheme` 自动决议的机制。不写这个类，系统深色下拿到的是整套浅色。
 *
 * 放在 <head> 里同步执行：在首次绘制之前就落上类名，所以没有闪烁。
 * `color-scheme` 一并写上，好让滚动条、原生控件和表单也跟着换边——
 * 那一半是浏览器画的，CSS 变量管不着。
 */
const SYNC_COLOR_MODE = `(()=>{try{const m=matchMedia("(prefers-color-scheme: dark)"),a=e=>{const d=document.documentElement;d.classList.toggle("dark",e.matches);d.style.colorScheme=e.matches?"dark":"light"};a(m);m.addEventListener("change",a)}catch(e){}})()`;

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "人才搜索" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	/**
	 * 历史记录取在这里：它是**外壳的数据**，两屏都用，不属于其中任何一屏。
	 *
	 * 根路由的 loader 每次导航都会重跑（`staleTime` 默认 0），而在新的一份回来
	 * 之前，这个 match 上挂的**还是上一份数据**——于是列表在换屏时不清空、不闪，
	 * 直出的那一版也已经带着记录。这正是搜完一次要的行为：落到 `/s/:turnId` 的
	 * 同时，那一列里已经有刚搜的那条。
	 *
	 * 取不到就是 `null`，不往上抛：一份取不到的历史记录不该把整页换成错误页，
	 * 这一屏的正事（敲一句话去搜）跟它没有关系。
	 */
	loader: () =>
		recentSearches().then(
			(items) => items,
			() => null,
		),
	shellComponent: RootDocument,
	component: RootComponent,
	notFoundComponent: NotFound,
});

/**
 * 外壳：页框、顶栏，和这一屏。
 *
 * 它挂在**根路由**上，所以根 match 在导航之间不重挂——顶栏里开着的弹层不会被
 * 换屏关掉，外壳的数据也不会跟着重取。
 *
 * `<main>` 撑开剩下的高度（body 是一根竖列），零态那块因此在顶栏以下真正居中，
 * 而不是靠某个视口高度减去顶栏高度的算式。
 */
function RootComponent() {
	const recent = Route.useLoaderData();
	return (
		/*
		 * `isolate` 在这里开一个层叠上下文，把 z 尺度那几档全部关进去。
		 * coss 的 Dialog 遮罩与 Tooltip 定位器 portal 到 document.body 且写死 z-50；
		 * 关进去之后它们永远画在外壳之上，无论内部用到多大的 z——这类遮挡从结构上
		 * 不可能发生，不必再去记那个上限。
		 *
		 * `overflow-clip` 是给页框的：那两根线画在页宽列**外面** 12px 处，窄窗口下
		 * 会伸到视口之外，不剪掉就多一条横向滚动条。它不是滚动容器，吸顶照常。
		 */
		<div className="relative isolate flex flex-1 flex-col overflow-clip">
			<PageFrame />
			<AppHeader recent={recent} />
			<main className="flex flex-1 flex-col">
				<Outlet />
			</main>
		</div>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		/*
		 * `suppressHydrationWarning` 是上面那段脚本的必要配套，不是消音。
		 *
		 * 脚本在水合之前就往 <html> 上写了 `class` 和 `style`，而 SSR 直出的那份
		 * 没有它们（服务端不知道这台设备是深色还是浅色）。React 水合时逐属性比对，
		 * 发现多出来就报 "some attributes ... didn't match" 并且**不修补**。
		 * 属性本身是对的、要的就是它——差异是设计的一部分，只需要告诉 React
		 * 这一个节点不必比对。范围只到这一个元素，子树照常校验。
		 *
		 * 不能改成「水合后再用 useEffect 写」：那样首帧没有类名，深色模式下会先
		 * 闪一整屏白，而这段脚本存在的全部理由就是不闪。
		 */
		<html lang="zh-CN" suppressHydrationWarning>
			<head>
				<HeadContent />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: 常量脚本，无外部输入 */}
				<script dangerouslySetInnerHTML={{ __html: SYNC_COLOR_MODE }} />
			</head>
			{/*
			 * 整页滚动，不是「窗口锁死、内部某一栏自己滚」。
			 *
			 * 后者要给每一栏配一个滚动容器，于是滚轮的行为取决于指针停在哪一栏上，
			 * 浏览器自己的滚动条也不出现。这里只有一列名单，它就该像一份文档一样
			 * 整页滚：滚动条是全局那一根，Home/End、空格翻页、移动端的下拉回弹
			 * 全都白拿。
			 */}
			<body className="flex min-h-dvh flex-col bg-canvas text-foreground">
				<TooltipProvider>{children}</TooltipProvider>
				<Scripts />
			</body>
		</html>
	);
}

function NotFound() {
	return <DeadEnd description="链接无效或页面已被移除。" title="页面不存在" />;
}
