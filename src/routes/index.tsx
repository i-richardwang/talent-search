import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { HomeScreen } from "./-components/home-screen";
import { useCommit } from "./-lib/commit";

/**
 * 首页：开一次新的搜索。地址上的 `mode` 说开哪一种，对话是默认、不写；查询理解
 * 没配置时只有关键词。最近搜索和查询理解配没配由根路由取，和导航栏用同一份。
 */
export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>): { mode?: "keyword" } =>
		search.mode === "keyword" ? { mode: "keyword" } : {},
	component: Home,
});

function Home() {
	// 提交放在路由这一层，界面组件不碰 router，tests/product-copy.test.tsx 才能直出它
	const { commit, error } = useCommit();
	const { recent, understanding } = useLoaderData({ from: "__root__" });
	const { mode } = Route.useSearch();
	return (
		<HomeScreen
			asked={mode}
			error={error}
			onQuery={commit}
			recent={recent}
			understanding={understanding}
		/>
	);
}
