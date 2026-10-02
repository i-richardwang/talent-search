"use client";

import { motion, useTransform } from "motion/react";
import {
	type ComponentProps,
	type CSSProperties,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { cn } from "#/lib/utils";
import {
	createPanelController,
	type PanelController,
	type PanelOptions,
	type PanelPlacement,
} from "./draggable-panel-controller";
import { foldTransition } from "./motion-token";

/*
 * 可拖动宽度的侧面板，宽度状态在 draggable-panel-controller.ts。贴着面板朝内容那一侧的边
 * 有一条分隔条：拖动调宽，双击回到 `defaultSize`，聚焦后可用键盘调宽、展开收起。
 * `size` 给了就是受控的宽，拖完一次（放手时）回调 `onSizeChange`，记不记住由调用方定。
 * 收着时分隔条不渲染，内容不可交互。
 */

/** 按下后挪过这么多像素才算开始拖，双击和点一下不会带出一次拖动。 */
const PAN_THRESHOLD = 3;

const HANDLE_SIZE_FINE = 8;
const HANDLE_SIZE_WIDE = 16;
const HANDLE_SIZE_COARSE = 20;

/** 收着时内容缩到这么大，从面板贴着的那一边缩。 */
const COLLAPSED_SCALE = 0.97;

const useIsomorphicLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

const subscribeCoarse = (onChange: () => void) => {
	const list = matchMedia("(pointer: coarse)");
	list.addEventListener("change", onChange);
	return () => list.removeEventListener("change", onChange);
};

function useHandleSize(wide: boolean) {
	const coarse = useSyncExternalStore(
		subscribeCoarse,
		() => matchMedia("(pointer: coarse)").matches,
		() => false,
	);
	if (coarse) return HANDLE_SIZE_COARSE;
	return wide ? HANDLE_SIZE_WIDE : HANDLE_SIZE_FINE;
}

function usePanel(controller: PanelController) {
	const state = useSyncExternalStore(
		controller.subscribe,
		() => controller.state,
		() => controller.state,
	);
	const target = useSyncExternalStore(
		controller.subscribe,
		() => controller.target,
		() => controller.target,
	);
	return { state, target };
}

interface DraggablePanelProps extends Omit<ComponentProps<"aside">, "onDrag"> {
	/** 根元素。默认 `aside`；里面另有地标（如导航栏的 `nav`）时用 `div`。 */
	as?: "aside" | "div";
	/** 按行内方向解释，从右往左排版时对调。 */
	placement?: PanelPlacement;
	size?: number;
	/** 不受控时的初始宽，也是双击复原到的宽。 */
	defaultSize?: number;
	minWidth?: number;
	maxWidth?: number;
	/** 拖完一次、键盘调宽或双击复原后的宽。 */
	onSizeChange?: (width: number) => void;
	expand?: boolean;
	onExpandChange?: (expand: boolean) => void;
	/** 为假时分隔条只留光标和手感，不画线。 */
	showBorder?: boolean;
	/** 放宽分隔条的可点宽度；粗指针（触屏）一律最宽。 */
	showHandleWideArea?: boolean;
	classNames?: { content?: string };
}

export function DraggablePanel({
	as: Root = "aside",
	placement = "right",
	size,
	defaultSize = 280,
	minWidth = 0,
	maxWidth,
	onSizeChange,
	expand,
	onExpandChange,
	showBorder = true,
	showHandleWideArea = true,
	classNames,
	className,
	children,
	...props
}: DraggablePanelProps) {
	const [innerExpand, setInnerExpand] = useState(true);
	const isExpand = expand ?? innerExpand;
	const setExpand = useCallback(
		(next: boolean) => {
			if (expand === undefined) setInnerExpand(next);
			onExpandChange?.(next);
		},
		[expand, onExpandChange],
	);
	const [innerSize, setInnerSize] = useState(defaultSize);
	const currentSize = size ?? innerSize;
	const commitSize = useCallback(
		(next: number) => {
			if (size === undefined) setInnerSize(next);
			onSizeChange?.(next);
		},
		[size, onSizeChange],
	);

	const options: PanelOptions = {
		defaultSize,
		expand: isExpand,
		max: maxWidth,
		min: minWidth,
		onExpandChange: setExpand,
		onSizeChange: commitSize,
		placement,
		size: currentSize,
	};
	const [controller] = useState(() => createPanelController(options));
	const { state, target } = usePanel(controller);
	const ref = useRef<HTMLDivElement>(null);

	useIsomorphicLayoutEffect(() => {
		controller.sync(options);
	});
	useIsomorphicLayoutEffect(() => {
		const node = ref.current;
		return node ? controller.attach(node) : undefined;
	}, [controller]);

	const extent = useTransform(controller.motion.size, (v) => Math.max(0, v));
	const clipping = state.dragging || state.folding || target === 0;

	return (
		<Root
			{...props}
			className={cn("ui-draggable-panel", className)}
			data-expand={isExpand}
			data-placement={placement}
			data-resizing={state.dragging || undefined}
			ref={ref}
		>
			<motion.div
				className="ui-draggable-panel-frame"
				inert={!isExpand}
				style={{ overflow: clipping ? "clip" : "visible", width: extent }}
			>
				<motion.div
					animate={{ scale: isExpand ? 1 : COLLAPSED_SCALE }}
					className={cn("ui-draggable-panel-content", classNames?.content)}
					initial={false}
					style={{ width: controller.motion.content }}
					transition={foldTransition()}
				>
					{children}
				</motion.div>
			</motion.div>
			{isExpand && (
				<Handle
					controller={controller}
					max={controller.bounds().max}
					min={controller.bounds().min}
					resizing={state.dragging}
					showBorder={showBorder}
					target={target}
					wide={showHandleWideArea}
				/>
			)}
		</Root>
	);
}

function Handle({
	controller,
	max,
	min,
	resizing,
	showBorder,
	target,
	wide,
}: {
	controller: PanelController;
	max: number;
	min: number;
	resizing: boolean;
	showBorder: boolean;
	target: number;
	wide: boolean;
}) {
	const size = useHandleSize(wide);
	const pressed = useRef<number | null>(null);
	const dragging = useRef(false);
	const dragged = useRef(false);
	useEffect(() => () => controller.drag.cancel(), [controller]);

	const reset = () => {
		pressed.current = null;
		dragging.current = false;
	};

	return (
		// biome-ignore lint/a11y/useSemanticElements: 可聚焦、可拖动的分隔条，<hr> 当不了
		<div
			aria-label="调整宽度"
			aria-orientation="vertical"
			aria-valuemax={Number.isFinite(max) ? max : undefined}
			aria-valuemin={min}
			aria-valuenow={target}
			aria-valuetext={`${target} 像素`}
			className="ui-draggable-panel-handle"
			data-border={showBorder}
			data-resizing={resizing || undefined}
			onDoubleClick={() => {
				if (!dragged.current) controller.reset();
			}}
			onKeyDown={(event) => controller.resizeByKey(event)}
			// 捕获可能在拖动中途被抢走，之后收不到 pointerup；指针停在用户最后拖到的地方，
			// 按那里提交而不是弹回去
			onLostPointerCapture={() => {
				if (dragging.current) controller.drag.end();
				reset();
			}}
			onPointerCancel={() => {
				controller.drag.cancel();
				reset();
			}}
			onPointerDown={(event) => {
				dragged.current = false;
				pressed.current = event.clientX;
				// 合成的 pointerdown 没有活动的指针，捕获会抛错
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {}
			}}
			onPointerMove={(event) => {
				if (pressed.current === null) return;
				const offset = event.clientX - pressed.current;
				if (!dragging.current) {
					if (Math.abs(offset) < PAN_THRESHOLD) return;
					dragging.current = true;
					dragged.current = true;
					controller.drag.start();
				}
				controller.drag.move(offset);
			}}
			onPointerUp={() => {
				if (dragging.current) controller.drag.end();
				reset();
			}}
			role="separator"
			style={{ "--draggable-panel-handle-size": `${size}px` } as CSSProperties}
			tabIndex={0}
		/>
	);
}
