import { useRouterState } from "@tanstack/react-router";
import { onlyMore, type View, validateView, viewChanged } from "./view-params";

/** 区分整份结果失效与在现有结果后继续加载。 */
type NavPhase = {
	growing: boolean;
	/** 现有名单已经不再成立。 */
	navigating: boolean;
};

export type Spot = {
	turn: string | undefined;
	view: View;
};

export function navPhase(
	loading: boolean,
	next: Spot,
	prev: Spot | undefined,
): NavPhase {
	if (!loading) return { growing: false, navigating: false };
	const sameTurn = prev?.turn === next.turn;
	const growing = sameTurn && onlyMore(next.view, prev?.view);
	return {
		growing,
		navigating: !growing && (!sameTurn || viewChanged(next.view, prev?.view)),
	};
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
