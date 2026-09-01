import { createFileRoute } from "@tanstack/react-router";
import { Brand } from "#/components/brand";
import { fetchOverview, recentSearches } from "#/server/functions";
import { ZeroState } from "./-components/zero-state";
import { useCommit } from "./-lib/commit";

/**
 * 零态：还没有查询的时候。
 *
 * 它是一个**独立的页面**，不是工作台的一个分支。两屏现在都是单列了，但共用的
 * 只是版心宽度那一个数——这一屏没有名单、没有筛选、没有吸顶的查询台，
 * 输入框是居中的主角而不是一条工具栏。用一个 `有查询 ? A : B` 的三元把它们
 * 装进同一个组件，只是把两个页面挤在了一起。
 *
 * 语料概览和最近搜索一起取：两条查询互不依赖，串行等于白等一跳。
 */
export const Route = createFileRoute("/")({
	loader: async () => {
		const [overview, recent] = await Promise.all([
			fetchOverview(),
			recentSearches(),
		]);
		return { overview, recent };
	},
	component: Home,
});

function Home() {
	const { overview, recent } = Route.useLoaderData();
	// 提交在这一层，不在 ZeroState 里：那个组件只画界面，于是它能脱开路由测
	// （tests/product-copy.test.tsx 直出它，不搭 router）。
	const { commit, pending, error } = useCommit();

	return (
		<div className="flex min-h-dvh flex-col">
			{/* 品牌行和工作台是同一条高度、同一条版心左起点：两屏之间
			    只有下面那块内容在变，身份的位置一动不动 */}
			<header className="mx-auto flex h-14 w-full max-w-page shrink-0 items-center px-4">
				<Brand />
			</header>
			<ZeroState
				error={error}
				onQuery={commit}
				overview={overview}
				pending={pending}
				recent={recent}
			/>
		</div>
	);
}
