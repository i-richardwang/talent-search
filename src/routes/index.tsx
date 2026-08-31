import { UsersThreeIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { fetchOverview, recentSearches } from "#/server/functions";
import { ZeroState } from "./-components/zero-state";
import { useCommit } from "./-lib/commit";

/**
 * 零态：还没有查询的时候。
 *
 * 它是一个**独立的页面**，不是工作台的一个分支：这两屏没有任何共用的结构，
 * 一个是居中的单列，一个是三栏工作台。用一个 `有查询 ? 三栏 : 零态` 的三元
 * 把它们装进同一个组件，只是把两个页面挤在了一起。
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
		<div className="flex h-dvh flex-col">
			{/* 顶栏和工作台是同一条 56px、同一个左起点，两屏之间只有下面那块内容在变 */}
			<header className="flex h-14 shrink-0 items-center gap-3 pr-3">
				<Link
					className="flex shrink-0 items-center gap-2 px-4 text-kumo-default no-underline"
					to="/"
				>
					<UsersThreeIcon
						className="text-kumo-brand"
						size={20}
						weight="duotone"
					/>
					<h1 className="font-semibold text-lg">人才搜索</h1>
				</Link>
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
