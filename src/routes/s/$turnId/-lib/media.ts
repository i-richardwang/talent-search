import { useSyncExternalStore } from "react";

/** 右栏（线程或详情）常驻在名单旁边的分界，和 Tailwind 的 `xl` 同值。 */
const WIDE = "(min-width: 80rem)";

// 取的时候才建、只建一次：服务端没有 window，getSnapshot 会被反复调用。
let query: MediaQueryList | undefined;
function mql() {
	query ??= window.matchMedia(WIDE);
	return query;
}

function subscribe(onChange: () => void) {
	mql().addEventListener("change", onChange);
	return () => mql().removeEventListener("change", onChange);
}

/**
 * 够不够宽，让右栏常驻在名单旁边。
 *
 * 宽窄两套容器二选一地挂：窄屏的详情是模态浮层，CSS 藏得住它的样子，藏不住它的
 * 焦点陷阱和滚动锁定。
 *
 * 服务端与首帧一律答「宽」，水合前后是同一份 HTML。首帧在窄屏上落在某个人身上时，
 * 右栏的槽靠 `max-xl:hidden`（workspace-layout.tsx）先藏住。
 */
export function useIsWide() {
	return useSyncExternalStore(
		subscribe,
		() => mql().matches,
		() => true,
	);
}
