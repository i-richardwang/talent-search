import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterContextProvider,
	useRouterState,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

/*
 * 预览页里给用到 `Link`、`useNavigate` 的产品组件搭的最小 router。历史记录在内存里，
 * 点链接只改这个 router 自己的地址，iframe 仍停在 `/preview`。组件直接画在
 * router 的上下文里，不经过路由匹配，所以服务端渲染（页的测试）一次就画得出来。
 */

/** 产品组件会链过去的几条路径。只用来拼 href，每条路由什么都不画。 */
const PATHS = [
	"/",
	"/s/$turnId",
	"/s/$turnId/p/$empId",
	"/data",
	"/data/$empId",
	"/skills",
	"/skills/$word",
	"/tasks",
];

function memoryRouter(url: string) {
	const root = createRootRoute();
	return createRouter({
		history: createMemoryHistory({ initialEntries: [url] }),
		routeTree: root.addChildren(
			PATHS.map((path) => createRoute({ getParentRoute: () => root, path })),
		),
	});
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
	useEffect(() => {
		void router.load();
		return router.history.subscribe(() => void router.load());
	}, [router]);
	return (
		<RouterContextProvider router={router}>{children}</RouterContextProvider>
	);
}

/**
 * 内存 router 地址上开着的是哪个人：`/s/:turnId/p/:empId` 的最后一段，没开是 undefined。
 * 组件不经过路由匹配，读不到路由参数，所以从地址上取。
 */
export function useOpenEmpId() {
	return useRouterState({
		select: (state) => /\/p\/([^/]+)$/.exec(state.location.pathname)?.[1],
	});
}
