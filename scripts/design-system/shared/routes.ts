import {
	type CatalogModule,
	type CatalogPage,
	catalog,
	pageById,
} from "./catalog";

/*
 * 外壳的地址写在 hash 里：`#/` 是总览，`#/<模块>` 是模块页，`#/<模块>/<页>` 是一页，
 * 最后这种正是页的身份。可以直接链接、前进后退。
 */

export type Route =
	| { kind: "overview" }
	| { kind: "module"; module: CatalogModule }
	| { kind: "page"; page: CatalogPage }
	| { kind: "notFound" };

export const href = {
	module: (module: CatalogModule) => `#/${module.id}`,
	overview: "#/",
	page: (page: CatalogPage) => `#/${page.id}`,
};

export function resolveRoute(hash: string): Route {
	const path = hash.replace(/^#\/?/, "").replace(/\/$/, "");
	if (!path) return { kind: "overview" };
	const module = catalog.find((item) => item.id === path);
	if (module) return { kind: "module", module };
	const page = pageById(path);
	return page ? { kind: "page", page } : { kind: "notFound" };
}

/** 路由的标题：页头与浏览器标签页用。 */
export const routeTitle = (route: Route) =>
	route.kind === "overview"
		? "设计系统"
		: route.kind === "module"
			? route.module.title
			: route.kind === "page"
				? route.page.title
				: "页面不存在";
