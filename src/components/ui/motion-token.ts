import type { Transition } from "motion/react";

/*
 * 对话框和抽屉用 motion 做进出场，时长与曲线读 `styles.css` 的动效令牌：
 * 时长写成毫秒，曲线写成 `cubic-bezier(…)` 或 `linear`。每次打开、关上时现读，
 * 改了令牌下一次开合就生效。服务端渲染时没有样式可读，这一次用 motion 自己的默认值。
 */

type Easing = [number, number, number, number] | "linear";

const read = (token: string) =>
	typeof document === "undefined"
		? ""
		: getComputedStyle(document.documentElement).getPropertyValue(token).trim();

/** 时长令牌换成 motion 用的秒。 */
function durationOf(token: string): number | undefined {
	const ms = Number.parseFloat(read(token));
	return Number.isFinite(ms) ? ms / 1000 : undefined;
}

/** 曲线令牌换成 motion 的写法。 */
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

/** 面板进场或退场：时长各组件一对，进场走柔和曲线、退场走加速曲线。 */
export const panelTransition = (
	component: "modal" | "drawer",
	phase: "enter" | "exit",
): Transition => ({
	duration: durationOf(`--duration-${component}-${phase}`),
	ease: easeOf(PHASE_EASE[phase]),
});

/** 可拖动面板展开收起时的宽度动画（`DraggablePanel`）。 */
export const foldTransition = (): Transition => ({
	duration: durationOf("--duration-panel-fold"),
	ease: easeOf("--ease-soft"),
});

/** 遮罩的淡入淡出，对话框和抽屉共用。 */
export const backdropTransition = (): Transition => ({
	duration: durationOf("--duration-backdrop"),
	ease: easeOf("--ease-soft"),
});
