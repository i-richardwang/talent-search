/**
 * 在一个 router 里渲染一次。用了 `Link` 的组件离开 router 画不出来；
 * 这里只搭一条路由，够组件读地址、判定当前、拼出 href。
 */
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";

export async function routed(
	component: () => React.ReactNode,
	{
		path = "/",
		url = path,
		validateSearch,
	}: {
		/** 这条路由的路径模式，如 `/s/$turnId`。 */
		path?: string;
		/** 当前所在的地址。 */
		url?: string;
		/** 这条路由的地址参数校验函数；不给就是不收参数。 */
		validateSearch?: (search: Record<string, unknown>) => object;
	} = {},
): Promise<string> {
	const root = createRootRoute();
	const page = createRoute({
		getParentRoute: () => root,
		path,
		validateSearch,
		component,
	});
	const router = createRouter({
		routeTree: root.addChildren([page]),
		history: createMemoryHistory({ initialEntries: [url] }),
	});
	await router.load();
	return renderToStaticMarkup(<RouterProvider router={router} />);
}
