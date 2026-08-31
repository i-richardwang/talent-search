import { useSyncExternalStore } from "react";

/** 三栏展开的分界，和 Tailwind 的 `xl` 同一个值（用 rem，跟随根字号）。 */
const WIDE = "(min-width: 80rem)";

// 只建一次：getSnapshot 会被 React 反复调用，每次 new 一个 MediaQueryList 是白费。
// 服务端没有 window，所以取的时候才建。
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
 * 现在是不是三栏常驻的宽度。
 *
 * 这个分界只有 JS 答得了：xl 以下两侧栏是**模态**浮层，而 CSS 能把一个浮层藏起来，
 * 藏不掉它的焦点陷阱和滚动锁定——给 `Dialog` 加个 `xl:hidden` 会在桌面上留下一个
 * 看不见却抓着焦点、还锁着滚动的对话框，比没有模态更糟。所以宽窄两套容器只能
 * 二选一地渲染，选择权在这里。
 *
 * 服务端与首帧一律答「宽」：这是内网桌面工具，直出主场景。窄屏的第一帧因此会
 * 渲染宽屏那一套，靠它们身上的 `max-xl:hidden` 挡住不露脸，挂载后再切过来——
 * 服务端与客户端首次渲染给出同一份 HTML，不会有水合不一致。
 */
export function useIsWide() {
	return useSyncExternalStore(
		subscribe,
		() => mql().matches,
		() => true,
	);
}
