import { useRouterState } from "@tanstack/react-router";
import { onlyMore, type View, validateView, viewChanged } from "./view-params";

/**
 * 一次导航对名单意味着什么。三项至多一项为真：
 *
 * - `growing`：同一条记录、同一份筛选，只是多加载一页；已经看到的人留在原地。
 * - `refreshing`：同一条记录换了筛选；旧名单还是这批候选，留在原地调暗，等新的替换。
 * - `replacing`：换了一条记录或第一次进来；旧名单回答的是另一个问题，不留着。
 */
type NavPhase = {
	growing: boolean;
	refreshing: boolean;
	replacing: boolean;
};

export type Spot = {
	turn: string | undefined;
	view: View;
};

const IDLE: NavPhase = { growing: false, refreshing: false, replacing: false };

export function navPhase(
	loading: boolean,
	next: Spot,
	prev: Spot | undefined,
): NavPhase {
	if (!loading) return IDLE;
	if (!prev || prev.turn !== next.turn) return { ...IDLE, replacing: true };
	if (onlyMore(next.view, prev.view)) return { ...IDLE, growing: true };
	return { ...IDLE, refreshing: viewChanged(next.view, prev.view) };
}

export type SearchPhase = "interpreting" | "searching";

/**
 * 名单在等什么、等的时候长什么样。`dim`：改了筛选，旧名单还是这批候选，留在原地
 * 调暗；`skeleton`：换了问题或第一次进来，旧名单不成立，画同形的占位行。
 */
export type ListWait = { phase: SearchPhase; list: "dim" | "skeleton" };

/** `interpreting`：看着的这一轮还没理解出条件，正在理解。 */
export function listWait(
	interpreting: boolean,
	{ refreshing, replacing }: NavPhase,
): ListWait | null {
	if (interpreting) return { list: "skeleton", phase: "interpreting" };
	if (replacing) return { list: "skeleton", phase: "searching" };
	if (refreshing) return { list: "dim", phase: "searching" };
	return null;
}

function turnOf(pathname: string) {
	return pathname.split("/")[2];
}

export function useNavPhase(): NavPhase {
	const nav = useRouterState({
		select: (s) => ({
			loading: s.isLoading,
			next: {
				turn: turnOf(s.location.pathname),
				view: validateView(s.location.search),
			},
			prev: s.resolvedLocation && {
				turn: turnOf(s.resolvedLocation.pathname),
				view: validateView(s.resolvedLocation.search),
			},
		}),
	});
	return navPhase(nav.loading, nav.next, nav.prev);
}
