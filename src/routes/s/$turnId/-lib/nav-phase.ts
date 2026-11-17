import { type ParsedLocation, useRouterState } from "@tanstack/react-router";
import { onlyMore, type View, validateView, viewChanged } from "./view-params";

/**
 * 一次导航对名单意味着什么。三项至多一项为真：
 *
 * - `growing`：同一条记录、同一份筛选，只是多加载一页；已经看到的人留在原地。
 * - `refreshing`：同一条记录换了筛选；旧名单还是这批候选，留在原地调暗，等新的替换。
 * - `replacing`：换了一条记录或第一次进来；旧名单回答的是另一个问题，不留着。
 *
 * 去别的页面的导航和名单无关，三项都为 false。
 */
type NavPhase = {
	growing: boolean;
	refreshing: boolean;
	replacing: boolean;
};

/** 查询页上的一处：哪一条记录、什么视图。 */
export type Spot = {
	turn: string;
	view: View;
};

const IDLE: NavPhase = { growing: false, refreshing: false, replacing: false };

export function navPhase(
	loading: boolean,
	next: Spot | undefined,
	prev: Spot | undefined,
): NavPhase {
	if (!loading || !next) return IDLE;
	if (!prev || prev.turn !== next.turn) return { ...IDLE, replacing: true };
	if (onlyMore(next.view, prev.view)) return { ...IDLE, growing: true };
	return { ...IDLE, refreshing: viewChanged(next.view, prev.view) };
}

export type SearchPhase = "understanding" | "searching" | "completing";

/**
 * 名单在等什么、等的时候长什么样。`dim`：改了筛选，旧名单还是这批候选，留在原地
 * 调暗；`skeleton`：换了问题或第一次进来，旧名单不成立，画同形的占位行；`keep`：名单上已有的
 * 人都成立、照常可用，只是还会再多出几个。
 */
export type ListWait = {
	phase: SearchPhase;
	list: "dim" | "skeleton" | "keep";
	/**
	 * 从哪一刻开始等：AI 的处理是服务端记下的这一次开始的时刻。搜索由导航发起，没有记下的
	 * 时刻，为 null。
	 */
	since: number | null;
};

/**
 * AI 正在处理看着的这一轮：`understanding` 是还没理解出条件；`completing` 是条件已经有了
 * （HR 直接改的），名单先按已有的出，AI 在补上新进范围的人。`startedAt` 是这一次开始的时刻。
 */
export function listWait(
	ai: "understanding" | "completing" | null,
	startedAt: number | null,
	{ refreshing, replacing }: NavPhase,
): ListWait | null {
	if (ai === "understanding")
		return { list: "skeleton", phase: "understanding", since: startedAt };
	if (replacing) return { list: "skeleton", phase: "searching", since: null };
	if (refreshing) return { list: "dim", phase: "searching", since: null };
	if (ai === "completing")
		return { list: "keep", phase: "completing", since: startedAt };
	return null;
}

/** 地址落在查询页上的哪一处；不是查询页就没有。 */
function spotOf({ pathname, search }: ParsedLocation): Spot | undefined {
	const [, root, turn] = pathname.split("/");
	return root === "s" && turn
		? { turn, view: validateView(search) }
		: undefined;
}

export function useNavPhase(): NavPhase {
	const nav = useRouterState({
		select: (s) => ({
			loading: s.isLoading,
			next: spotOf(s.location),
			prev: s.resolvedLocation && spotOf(s.resolvedLocation),
		}),
	});
	return navPhase(nav.loading, nav.next, nav.prev);
}
