import { animate, type MotionValue, motionValue } from "motion";
import { foldTransition } from "./motion-token";

/*
 * `DraggablePanel` 的宽度状态，与 React 无关：拖动、键盘调宽、双击复原、展开收起的
 * 宽度动画都在这里。宽度放在两个 motion 值里，拖动时逐帧改值不经过 React 渲染：
 * `size` 是面板外框的宽，收起时动画到 0；`content` 是里面内容的宽，收起过程中保持
 * 原宽，内容整块滑出而不是被挤窄重排。
 */

export type Placement = "left" | "right";

/** 键盘每按一下调多少像素；按住 Shift 或用 PageUp/PageDown 时是快档。 */
const KEY_STEP = 10;
const KEY_STEP_FAST = 50;

/** 屏幕上往右为正；面板往哪边长由 `grow` 换算。 */
const SCREEN_DELTA: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

/** 左边的面板往右拖变宽，右边的面板往左拖变宽。 */
const GROW: Record<Placement, 1 | -1> = { left: 1, right: -1 };

export interface PanelOptions {
	defaultSize: number;
	expand: boolean;
	max?: number;
	min: number;
	onExpandChange?: (expand: boolean) => void;
	onSizeChange?: (size: number) => void;
	onSizeDragging?: (size: number) => void;
	placement: Placement;
	size: number;
}

export interface PanelState {
	dragging: boolean;
	/** 展开或收起的宽度动画进行中 */
	folding: boolean;
}

interface KeyInput {
	key: string;
	preventDefault: () => void;
	shiftKey: boolean;
}

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

const reducedMotion = () =>
	typeof matchMedia === "function" &&
	matchMedia("(prefers-reduced-motion: reduce)").matches;

let locks = 0;
let saved = { cursor: "", userSelect: "" };

/**
 * 拖动期间整页换成调宽的光标、禁止选中文字，Esc 取消这次拖动。
 * 同时有几处在拖时按计数恢复，最后一处放手才还原 `<body>` 的样式。
 */
function lockBody(onEscape: () => void) {
	const { style } = document.body;
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			event.preventDefault();
			onEscape();
		}
	};
	if (locks === 0)
		saved = { cursor: style.cursor, userSelect: style.userSelect };
	locks += 1;
	style.cursor = "col-resize";
	style.userSelect = "none";
	addEventListener("keydown", onKeyDown, true);
	return () => {
		locks -= 1;
		if (locks === 0) Object.assign(style, saved);
		removeEventListener("keydown", onKeyDown, true);
	};
}

export function createPanelController(initial: PanelOptions) {
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) listener();
	};

	let element: HTMLElement | null = null;
	let options = initial;
	let target = initial.expand ? initial.size : 0;
	let state: PanelState = { dragging: false, folding: false };
	let unlock: (() => void) | undefined;
	let foldTo = target;
	// 挂上之后的第一帧里宽度的变化（水合后读到记住的宽度）直接到位，不做动画
	let settled = false;

	const size: MotionValue<number> = motionValue(target);
	const content: MotionValue<number> = motionValue(initial.size);
	const session = { max: 0, min: 0, sign: 1, start: 0 };

	const patch = (next: Partial<PanelState>) => {
		const changed = (Object.keys(next) as (keyof PanelState)[]).some(
			(key) => state[key] !== next[key],
		);
		if (!changed) return;
		state = { ...state, ...next };
		notify();
	};

	const bounds = () => {
		const min = Math.max(0, options.min);
		const max =
			options.max === undefined
				? Number.POSITIVE_INFINITY
				: Math.max(min, options.max);
		return { max, min };
	};

	/** 从右往左排版时屏幕方向反过来。 */
	const growSign = () =>
		GROW[options.placement] *
		(element && getComputedStyle(element).direction === "rtl" ? -1 : 1);

	const transition = () =>
		reducedMotion() || !settled ? { duration: 0 } : foldTransition();

	const fold = (to: number) => {
		foldTo = to;
		patch({ folding: true });
		if (size.get() === 0) content.jump(to || content.get());
		else if (to > 0) animate(content, to, transition());
		animate(size, to, transition());
	};

	const release = () => {
		unlock?.();
		unlock = undefined;
	};

	const stopDragging = () => {
		release();
		patch({ dragging: false });
	};

	const drag = {
		cancel: () => {
			if (!state.dragging) return;
			size.jump(session.start);
			content.jump(session.start);
			stopDragging();
		},
		end: () => {
			if (!state.dragging) return;
			const committed = size.get();
			stopDragging();
			options.onSizeChange?.(committed);
		},
		move: (offsetX: number) => {
			if (!state.dragging) return;
			const next = Math.round(
				clamp(session.start + offsetX * session.sign, session.min, session.max),
			);
			size.jump(next);
			content.jump(next);
			options.onSizeDragging?.(next);
		},
		start: () => {
			Object.assign(session, {
				...bounds(),
				sign: growSign(),
				start: size.get(),
			});
			release();
			unlock = lockBody(drag.cancel);
			patch({ dragging: true, folding: false });
		},
	};

	/** 分隔条上的键盘：左右方向键、PageUp/PageDown 调宽，Home/End 到两头，回车或空格展开收起。 */
	const resizeByKey = (event: KeyInput) => {
		if (event.key === "Enter" || event.key === " ") {
			if (!options.onExpandChange) return;
			event.preventDefault();
			options.onExpandChange(!options.expand);
			return;
		}
		const { max, min } = bounds();
		const fast =
			event.shiftKey || event.key === "PageUp" || event.key === "PageDown";
		const step = (fast ? KEY_STEP_FAST : KEY_STEP) * growSign();
		const moves: Record<string, number> = {
			End: Number.isFinite(max) ? max : target,
			Home: min,
			PageDown: target + step,
			PageUp: target - step,
		};
		const screen = SCREEN_DELTA[event.key];
		const next =
			screen === undefined ? moves[event.key] : target + screen * step;
		if (next === undefined) return;
		event.preventDefault();
		const value = clamp(next, min, max);
		if (!options.expand && value > 0) options.onExpandChange?.(true);
		options.onSizeChange?.(value);
	};

	const sync = (next: PanelOptions) => {
		options = next;
		const value = next.expand ? next.size : 0;
		if (size.get() === 0 && value > 0) content.jump(next.size);
		if (value !== target) {
			target = value;
			notify();
		}
		if (state.dragging) return;
		if (size.get() === target) {
			// 反向切换可能在上一段动画还没走动时就落回目标，不停下它会冲过新的目标
			size.stop();
			content.stop();
			if (state.folding) {
				patch({ folding: false });
				content.jump(target || content.get());
			}
			foldTo = target;
		} else if (!state.folding || foldTo !== target) {
			fold(target);
		}
	};

	return {
		attach: (node: HTMLElement) => {
			element = node;
			const frame = requestAnimationFrame(() => {
				settled = true;
			});
			const stopSettle = size.on("animationComplete", () => {
				if (size.get() === target) patch({ folding: false });
			});
			return () => {
				cancelAnimationFrame(frame);
				stopSettle();
				release();
				element = null;
			};
		},
		bounds,
		drag,
		motion: { content, size },
		/** 双击分隔条：回到默认宽度，收着的先展开。 */
		reset: () => {
			if (!options.expand) options.onExpandChange?.(true);
			options.onSizeChange?.(options.defaultSize);
		},
		resizeByKey,
		get state() {
			return state;
		},
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		sync,
		get target() {
			return target;
		},
	};
}

export type PanelController = ReturnType<typeof createPanelController>;
