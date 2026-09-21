import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { buttonVariants } from "#/components/ui/button";
import { TooltipProvider } from "#/components/ui/tooltip";
import { recentSearches } from "#/server/functions";
import appCss from "../styles.css?url";
import { AppHeader } from "./-components/app-header";
import { DeadEnd } from "./-components/dead-end";
import { PageFrame } from "./-components/page-frame";

// Runs before first paint so dark-mode tokens do not flash in their light state.
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
	loader: () =>
		recentSearches().then(
			(items) => items,
			() => null,
		),
	shellComponent: RootDocument,
	component: RootComponent,
	notFoundComponent: NotFound,
});

function RootComponent() {
	const recent = Route.useLoaderData();
	return (
		<div className="relative isolate flex flex-1 flex-col overflow-clip">
			<SkipToMain />
			<PageFrame />
			<AppHeader recent={recent} />
			<Outlet />
		</div>
	);
}

function SkipToMain() {
	return (
		<div className="fixed top-2 left-2 z-escape not-focus-within:sr-only">
			<a
				className={buttonVariants({ size: "sm", variant: "outline" })}
				href="#main"
			>
				跳到正文
			</a>
		</div>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		// The head script intentionally changes <html> before hydration.
		<html lang="zh-CN" suppressHydrationWarning>
			<head>
				<HeadContent />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: 常量脚本，无外部输入 */}
				<script dangerouslySetInnerHTML={{ __html: SYNC_COLOR_MODE }} />
			</head>
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
