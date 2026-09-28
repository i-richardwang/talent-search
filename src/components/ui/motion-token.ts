import type { Transition } from "motion/react";

/*
 * motion 的时长与曲线读 `styles.css` 的动效令牌，每次开合时现读，改了令牌下一次开合就生效。
 * 服务端渲染时没有样式可读，这一次用 motion 自己的默认值。
 */

type Easing = [number, number, number, number] | "linear";

const read = (token: string) =>
	typeof document === "undefined"
		? ""
		: getComputedStyle(document.documentElement).getPropertyValue(token).trim();

/** 令牌是毫秒，motion 要秒。 */
function durationOf(token: string): number | undefined {
	const ms = Number.parseFloat(read(token));
	return Number.isFinite(ms) ? ms / 1000 : undefined;
}

function easeOf(token: string): Easing | undefined {
	const value = read(token);
	if (value === "linear") return "linear";
	const points = /^cubic-bezier\(([^)]+)\)$/
		.exec(value)?.[1]
		?.split(",")
		.map(Number);
	return points?.length === 4 && points.every(Number.isFinite)
		? (points as Easing & number[])
		: undefined;
}

const PHASE_EASE = { enter: "--ease-soft", exit: "--ease-accelerate" } as const;

export const panelTransition = (
	component: "modal" | "drawer",
	phase: "enter" | "exit",
): Transition => ({
	duration: durationOf(`--duration-${component}-${phase}`),
	ease: easeOf(PHASE_EASE[phase]),
});

/** `DraggablePanel` 展开收起时的宽度动画。 */
export const foldTransition = (): Transition => ({
	duration: durationOf("--duration-panel-fold"),
	ease: easeOf("--ease-soft"),
});

export const backdropTransition = (): Transition => ({
	duration: durationOf("--duration-backdrop"),
	ease: easeOf("--ease-soft"),
});
