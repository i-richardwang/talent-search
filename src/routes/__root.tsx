import { Empty, LinkProvider, TooltipProvider } from "@cloudflare/kumo";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
	createRootRoute,
	HeadContent,
	Link,
	Scripts,
} from "@tanstack/react-router";
import { AppLink } from "#/components/app-link";
import appCss from "../styles.css?url";

/**
 * 把系统深浅色偏好写进 <html data-mode>，并跟着系统切换实时更新。
 *
 * 为什么必须有这段脚本：Kumo 的语义令牌走 `light-dark()`（跟随 color-scheme，
 * 不需要 JS），但 kumo-binding.css 里另有 7 条规则硬绑 `[data-mode="dark"]`
 * ——骨架屏底色、微光渐变、Tooltip/Popover 的 outline-offset。那个属性只有
 * 宿主写上去才存在。不写，系统深色下骨架屏就是一块浅色亮斑。
 *
 * 放在 <head> 里同步执行：在首次绘制之前就落上属性，所以没有闪烁。
 * 与其在自己的样式表里把 Kumo 那 7 条私有规则照抄一遍（类名一改就静默失效），
 * 不如把宿主该履行的契约履行掉。
 */
const SYNC_COLOR_MODE = `(()=>{try{const m=matchMedia("(prefers-color-scheme: dark)"),a=e=>document.documentElement.setAttribute("data-mode",e.matches?"dark":"light");a(m);m.addEventListener("change",a)}catch(e){}})()`;

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
		 * 脚本在水合之前就往 <html> 上写了 `data-mode`，而 SSR 直出的那份没有它
		 * （服务端不知道这台设备是深色还是浅色）。React 水合时逐属性比对，发现
		 * 多出一个属性就报 "some attributes ... didn't match" 并且**不修补**。
		 * 属性本身是对的、要的就是它——差异是设计的一部分，只需要告诉 React
		 * 这一个节点不必比对。范围只到这一个元素，子树照常校验。
		 *
		 * 不能改成"水合后再用 useEffect 写"：那样首帧没有属性，深色模式下会先
		 * 闪一块浅色骨架屏，而这段脚本存在的全部理由就是不闪。
		 */
		<html data-theme="kumo" lang="zh-CN" suppressHydrationWarning>
			<head>
				<HeadContent />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: 常量脚本，无外部输入 */}
				<script dangerouslySetInnerHTML={{ __html: SYNC_COLOR_MODE }} />
			</head>
			{/* 工作台：视口锁高，滚动由表格与详情栏各自负责 */}
			<body className="h-dvh overflow-hidden bg-kumo-canvas text-kumo-default">
				<LinkProvider component={AppLink}>
					<TooltipProvider>{children}</TooltipProvider>
				</LinkProvider>
				<Scripts />
			</body>
		</html>
	);
}

function NotFound() {
	return (
		<div className="flex h-dvh items-center justify-center p-6">
			<Empty
				contents={
					<Link
						className="text-kumo-link text-sm hover:underline"
						to="/"
						search={{}}
					>
						返回人才搜索
					</Link>
				}
				description="链接无效或页面已被移除。"
				icon={<MagnifyingGlassIcon size={44} weight="duotone" />}
				title="页面不存在"
			/>
		</div>
	);
}
