import { useRouterState } from "@tanstack/react-router";
import { onlyMore, type View, validateView, viewChanged } from "./view-params";

/**
 * 一次导航对名单意味着什么。三项至多一项为真：
 *
 * - `growing`：同一条记录、同一份筛选，只是多加载一页；已经看到的人留在原地。
 * - `refreshing`：同一条记录换了筛选；旧名单还是这批候选，留在原地调暗，等新的替换。
 * - `replacing`：换了一条记录或第一次进来；旧名单回答的是另一个问题，不再留着。
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
