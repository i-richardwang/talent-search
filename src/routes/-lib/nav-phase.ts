import { useRouterState } from "@tanstack/react-router";
import { onlyMore, type View, validateView, viewChanged } from "./view-params";

/**
 * 这次导航在干什么。
 *
 * 两种 pending 必须分开：改筛选时旧结果已经不成立，列表该塌成骨架屏；只是再翻
 * 一页时已经看到的人必须留在原地，否则每翻一页就把人扔回页首。而换人（只换
 * 详情路由）两件事都不是——结果表一行都不用重画。
 */
export type NavPhase = {
	/** 正在翻下一页：已经看到的人留在原地，只有按钮转圈 */
	growing: boolean;
	/** 下面那份名单已经不成立了：画骨架屏 */
	navigating: boolean;
};
// 两者互斥。翻页也会改 `n`，所以它同时满足 `viewChanged`——不排掉的话，
// 「留在原地」和「塌成骨架屏」会同时为真，而后者赢，翻一页就把人扔回页首。

/** 一次导航的两头各落在哪：哪条查询记录、什么视图。 */
export type Spot = {
	/** 查询记录的 id。换人时它不变，所以「换人」不会被当成「换查询」。 */
	turn: string | undefined;
	view: View;
};

/**
 * 纯的那一半：给定两头和「还在飞吗」，答这次导航在干什么。
 *
 * 和 `useNavPhase` 分开是为了能测——这三个布尔量的组合决定了列表塌不塌，
 * 而它错了不会有任何东西报错，只会在扫名单时每按一下就清空一次列表。
 */
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

/**
 * 从路径里取这次导航落在哪条查询记录上。
 *
 * pending 期间拿不到 `params`（那是导航完成之后的事），只有一个 pathname，
 * 所以这里手工取第二段。`/s/:turnId` 与 `/s/:turnId/p/:empId` 都落在同一段上。
 */
function turnOf(pathname: string) {
	return pathname.split("/")[2];
}

/**
 * 接上路由的那一半。
 *
 * `location` 是要去的地方，`resolvedLocation` 是还挂在屏幕上的那一个，差别正好
 * 回答「这次导航在干什么」。两边都过一遍 `validateView`，免得拿裸的 URL 值去比
 * （`n` 在一边是数字一边是字符串）。
 */
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
