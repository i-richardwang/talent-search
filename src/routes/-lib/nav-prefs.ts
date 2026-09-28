import { NAV_WIDTH } from "#/components/ui/app-layout";

/*
 * 导航栏记住的样子：宽、收没收起、哪几组收着、最近搜索列几条。记在一个 cookie 里，
 * 服务端直出时就读得到，首帧画出来就是记住的样子，水合前后一致。只属于这台浏览器。
 */

/** 记在哪个 cookie 里。根路由的 loader 按这个名字读（`__root.tsx`）。 */
export const NAV_COOKIE = "nav";

/** 最近搜索在导航栏里列几条，组名旁的菜单里选。 */
export const RECENT_COUNTS = [5, 10, 15, 20] as const;
export type RecentCount = (typeof RECENT_COUNTS)[number];

export type NavPrefs = {
	width: number;
	collapsed: boolean;
	/** 收着的组。组默认展开，只记收起的。 */
	folded: string[];
	recentCount: RecentCount;
};

/** 没记过、读不懂的那几项取默认值；宽夹在拖动的范围里。 */
export function navPrefsOf(raw: string | undefined): NavPrefs {
	const params = new URLSearchParams(raw ?? "");
	const width = Number(params.get("w"));
	const count = Number(params.get("n"));
	return {
		collapsed: params.get("c") === "1",
		folded: (params.get("g") ?? "").split(",").filter(Boolean),
		recentCount: RECENT_COUNTS.find((n) => n === count) ?? RECENT_COUNTS[0],
		width:
			params.has("w") && Number.isFinite(width)
				? Math.min(Math.max(Math.round(width), NAV_WIDTH.min), NAV_WIDTH.max)
				: NAV_WIDTH.default,
	};
}

function serialize(prefs: NavPrefs): string {
	return new URLSearchParams({
		c: prefs.collapsed ? "1" : "0",
		g: prefs.folded.join(","),
		n: String(prefs.recentCount),
		w: String(prefs.width),
	}).toString();
}

/** 写回 cookie，一年后过期。 */
export function writeNavPrefs(prefs: NavPrefs) {
	// biome-ignore lint/suspicious/noDocumentCookie: 服务端直出要读到它，只能是 cookie
	document.cookie = `${NAV_COOKIE}=${encodeURIComponent(serialize(prefs))}; path=/; max-age=31536000; samesite=lax`;
}
