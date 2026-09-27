import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	useRouterState,
} from "@tanstack/react-router";
import { createContext, type ReactNode, use, useState } from "react";
import { WorkbenchNav } from "#/routes/s/$turnId/-components/workbench-nav";
import { OUTCOME } from "./samples/people";
import { RECENT, THREAD } from "./samples/thread";

/*
 * 预览页里给用到 `Link`、`useNavigate`、`useParams`、`useLoaderData` 的产品组件搭的
 * 最小 router。历史记录在内存里，点链接只改这个 router 自己的地址，iframe 仍停在
 * `/preview`。页的内容是根路由画的东西，于是组件站在一个真的匹配里。
 *
 * 路由的形状和产品一致到组件读得到的程度：根路由的 loader 交出最近搜索和 AI 服务
 * 配没配，`/s/$turnId` 交出线程和名单、导航栏换成它的筛选（`staticData.nav`），
 * 人的详情挂在它下面。loader 都是同步读样例，建 router 时就把这一地址的匹配和
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

const ROOT_DATA = { recent: RECENT, understanding: true };
const TURN_DATA = { result: OUTCOME, thread: THREAD };

function memoryRouter(url: string) {
	const root = createRootRoute({
		component: () => use(Content),
		loader: () => ROOT_DATA,
	});
	const turn = createRoute({
		getParentRoute: () => root,
		loader: () => TURN_DATA,
		path: "/s/$turnId",
		staticData: { nav: WorkbenchNav },
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
		[root.id, ROOT_DATA],
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

/** 把页的内容放进一个站在 `url` 上的内存 router；点链接后地址在 router 里变，组件跟着重画。 */
export function Routed({
	children,
	url = "/",
}: {
	children: ReactNode;
	url?: string;
}) {
	const [router] = useState(() => memoryRouter(url));
	return (
		<Content value={children}>
			<RouterProvider router={router} />
		</Content>
	);
}

/**
 * 内存 router 地址上开着的是哪个人：`/s/:turnId/p/:empId` 的最后一段，没开是 undefined。
 * 页的内容站在根路由的匹配里，读不到子路由的参数，所以从地址上取。
 */
export function useOpenEmpId() {
	return useRouterState({
		select: (state) => /\/p\/([^/]+)$/.exec(state.location.pathname)?.[1],
	});
}
