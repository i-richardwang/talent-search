import { createFileRoute } from "@tanstack/react-router";
import { ZeroState } from "./-components/zero-state";
import { useCommit } from "./-lib/commit";

/**
 * 零态：还没有查询的时候。
 *
 * 它是一个**独立的页面**，不是工作台的一个分支。两屏共用的只有顶栏，
 * 页面本身完全不同——这一屏没有名单、没有筛选、没有抬头，输入框是居中的主角
 * 而不是一条工具栏。用一个 `有查询 ? A : B` 的三元把它们装进同一个组件，
 * 只是把两个页面挤在了一起。
 *
 * 没有 loader：这一屏不需要任何服务端数据就能画完，进来即可开始敲字。
 * 顶栏那份历史记录属于外壳，由根路由取（`__root.tsx`）。
 */
export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	// 提交在这一层，不在 ZeroState 里：那个组件只画界面，于是它能脱开路由测
	// （tests/product-copy.test.tsx 直出它，不搭 router）。
	const { commit, error } = useCommit();

	// 这一屏的正文就是那块输入面，它自己就是 `<main>`：没有名单、没有筛选，
	// 也就没有第二块需要和它区分开的东西。
	return (
		<main className="flex flex-1 flex-col" id="main" tabIndex={-1}>
			<ZeroState error={error} onQuery={commit} />
		</main>
	);
}
