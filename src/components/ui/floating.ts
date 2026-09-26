"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import {
	cloneElement,
	createContext,
	type ReactElement,
	type Ref,
	use,
} from "react";
import { isNativeButtonElement } from "#/components/ui/native-button";

/*
 * 浮层组件共用的部分：
 * - 弹出层把自己的定位器交给里面的浮层当 portal 容器，里面的提示渲染进弹出层自己的
 *   子树，和它一起叠放、一起卸载。
 * - 没有给容器时 portal 到 `<body>`。容器要显式给：不给的话 Base UI 会把浮层嵌进
 *   外层浮层的 portal。
 * - 定位器用 Base UI 的默认碰撞边距。
 * - 触发器不另包一层：Base UI 触发器的属性与 ref 合进子元素本身（`triggerRender`）。
 * - 弹层都在 `--z-index-popup` 这一档，不按打开先后另分配 z 值：portal 按打开先后接在
 *   `<body>` 末尾，后开的在文档里靠后，自然压住先开的；嵌在弹出层里的提示渲染进弹出层的子树。
 */

const FloatingLayerContext = createContext<HTMLElement | null>(null);

export const FloatingLayerProvider = FloatingLayerContext.Provider;

/** 没有指定容器时 portal 到的地方。浮层只在浏览器里打开，服务端没有 document。 */
export const defaultPortalContainer = (): HTMLElement | undefined =>
	typeof document === "undefined" ? undefined : document.body;

/** 最近一层弹出层的定位器；不在弹出层里是 null。 */
export const useFloatingLayer = (): HTMLElement | null =>
	use(FloatingLayerContext);

/** 把几个 ref 合成一个，触发器同时交给调用处、子元素自己和 Base UI。 */
function mergeRefs<T>(refs: (Ref<T> | undefined)[]) {
	return (node: T | null) => {
		const cleanups = refs.map((ref) => {
			if (typeof ref === "function") return ref(node);
			if (ref) ref.current = node;
			return undefined;
		});
		return () => {
			refs.forEach((ref, i) => {
				const cleanup = cleanups[i];
				if (typeof cleanup === "function") cleanup();
				else if (typeof ref === "function") ref(null);
				else if (ref) ref.current = null;
			});
		};
	};
}

type TriggerChildProps = Record<string, unknown> & { ref?: Ref<never> };

/**
 * 浮层触发器的 `render`：Base UI 给的属性与 ref 合进子元素本身。Base UI 给的
 * `type="button"` 只交给字面写的 `<button>`；子元素是组件（Button、ActionIcon）时不传，
 * 它们的 `type` 是外观，原生的 type 由组件自己定。Tooltip、Popover、DropdownMenu 共用。
 */
export function triggerRender(children: ReactElement) {
	const child = children as ReactElement<TriggerChildProps>;
	return (props: object) => {
		const { ref, type, ...rest } = props as TriggerChildProps & {
			type?: string;
		};
		const own = isNativeButtonElement(child) ? { ...rest, type } : rest;
		return cloneElement(child, {
			...(mergeProps(child.props, own) as TriggerChildProps),
			ref: mergeRefs([child.props.ref, ref]),
		});
	};
}
