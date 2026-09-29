import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	useRouterState,
} from "@tanstack/react-router";
import { createContext, type ReactNode, use, useState } from "react";
import type { TablePage } from "#/lib/paging";
import { type NavPrefs, navPrefsOf } from "#/routes/-lib/nav-prefs";
import type { RecentSearch } from "#/server/turn";
import { OUTCOME } from "./samples/people";
import { RECENT, THREAD } from "./samples/thread";

/*
 * 预览页里给用到 `Link`、`useNavigate`、`useParams`、`useLoaderData` 的产品组件搭的
 * 最小 router。历史记录在内存里，点链接只改这个 router 自己的地址，iframe 仍停在
 * `/preview`。页的内容是根路由画的东西，于是组件处在一个真实的路由匹配里。
 *
 * 路由的形状和产品一致到组件读得到的程度：根路由的 loader 提供导航栏记住的样子、
 * 最近搜索和 AI 服务配没配，`/s/$turnId` 提供线程和名单，人的详情是它的子路由。
 * loader 都是同步读样例，建 router 时就把这一地址的匹配和
 * loader 数据放好，服务端渲染（页的测试）一次就画得出来。
 */

/** 根路由画的东西：`Routed` 包住的那页内容。 */
const Content = createContext<ReactNode>(null);

/** 产品组件会链过去、除搜索结果页以外的几条路径。只用来拼 href，每条路由什么都不画。 */
const PATHS = [
	"/",
	"/data",
	"/data/$empId",
	"/skills",
	"/skills/$word",
	"/tasks",
];

/** 根路由提供的数据：导航栏记住的样子取默认值，最近搜索是样例的第一页。 */
export type RootData = {
	nav: NavPrefs;
	recent: TablePage<RecentSearch> | null;
	understanding: boolean;
};

const ROOT_DATA: RootData = {
	nav: navPrefsOf(undefined),
	recent: { from: 1, page: 1, pages: 1, rows: RECENT, total: RECENT.length },
	understanding: true,
};
const TURN_DATA = { result: OUTCOME, thread: THREAD };

function memoryRouter(url: string, rootData: RootData) {
	const root = createRootRoute({
		component: () => use(Content),
		loader: () => rootData,
	});
	const turn = createRoute({
		getParentRoute: () => root,
		loader: () => TURN_DATA,
		path: "/s/$turnId",
	});
	const router = createRouter({
		history: createMemoryHistory({ initialEntries: [url] }),
		routeTree: root.addChildren([
			...PATHS.map((path) => createRoute({ getParentRoute: () => root, path })),
			turn.addChildren([
				createRoute({ getParentRoute: () => turn, path: "p/$empId" }),
			]),
		]),
	});
	const loaded = new Map<string, unknown>([
		[root.id, rootData],
		[turn.id, TURN_DATA],
	]);
	router.stores.setMatches(
		router.matchRoutes(router.state.location).map((match) => ({
			...match,
			loaderData: loaded.get(match.routeId),
			status: "success",
		})),
	);
	return router;
}

/**
 * 把页的内容放进一个以 `url` 为初始地址的内存 router；点链接后地址在 router 里变，组件跟着重画。
 * `root` 换掉根路由提供的几项（没有搜索记录、取不到搜索记录），只在建 router 时读一次。
 */
export function Routed({
	children,
	url = "/",
	root,
}: {
	children: ReactNode;
	url?: string;
	root?: Partial<RootData>;
}) {
	const [router] = useState(() => memoryRouter(url, { ...ROOT_DATA, ...root }));
	return (
		<Content value={children}>
			<RouterProvider router={router} />
		</Content>
	);
}

/**
 * 内存 router 地址上开着的是哪个人：`/s/:turnId/p/:empId` 的最后一段，没开是 undefined。
 * 页的内容处在根路由的匹配里，读不到子路由的参数，所以从地址上取。
 */
export function useOpenEmpId() {
	return useRouterState({
		select: (state) => /\/p\/([^/]+)$/.exec(state.location.pathname)?.[1],
	});
}
