import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { HomeScreen } from "./-components/home-screen";
import { useCommit } from "./-lib/commit";

/**
 * 零态：还没有查询的时候。
 *
 * 它是一个**独立的页面**，不是工作台的一个分支。两屏共用的只有顶栏，
 * 页面本身完全不同——这一屏没有名单、没有筛选、没有抬头，输入面是主角
 * 而不是一条工具栏。
 *
 * 两种搜索各开一屏，由地址上的 `mode` 说是哪一种：输入面上方的切换就是换这个
 * 参数，可以收藏、可以后退。对话是默认，地址上不写；查询理解没配置时只有关键词，
 * 地址写的是什么都一样。
 *
 * 没有 loader：这一屏不需要任何服务端数据就能画完，进来即可开始敲字。
 * 顶栏那份历史记录和查询理解配没配，属于外壳，由根路由取（`__root.tsx`）。
 */
export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>): { mode?: "keyword" } =>
		search.mode === "keyword" ? { mode: "keyword" } : {},
	component: Home,
});

function Home() {
	// 提交在这一层，不在 ZeroState 里：那个组件只画界面，于是它能脱开路由测
	// （tests/product-copy.test.tsx 直出它，不搭 router）。
	const { commit, error } = useCommit();
	const { understanding } = useLoaderData({ from: "__root__" });
	const { mode } = Route.useSearch();
	return (
		<HomeScreen
			asked={mode}
			error={error}
			onQuery={commit}
			understanding={understanding}
		/>
	);
}
