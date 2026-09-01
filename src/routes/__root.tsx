import {
	createRootRoute,
	HeadContent,
	Link,
	Scripts,
} from "@tanstack/react-router";
import { SearchXIcon } from "lucide-react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#/components/ui/empty";
import { TooltipProvider } from "#/components/ui/tooltip";
import appCss from "../styles.css?url";

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
	shellComponent: RootDocument,
	notFoundComponent: NotFound,
});

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
			<body className="min-h-dvh bg-canvas text-foreground">
				<TooltipProvider>{children}</TooltipProvider>
				<Scripts />
			</body>
		</html>
	);
}

function NotFound() {
	return (
		<div className="flex h-dvh items-center justify-center p-6">
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<SearchXIcon />
					</EmptyMedia>
					<EmptyTitle>页面不存在</EmptyTitle>
					<EmptyDescription>链接无效或页面已被移除。</EmptyDescription>
				</EmptyHeader>
				<Link
					className="text-sm underline underline-offset-4 hover:text-primary"
					search={{}}
					to="/"
				>
					返回人才搜索
				</Link>
			</Empty>
		</div>
	);
}
