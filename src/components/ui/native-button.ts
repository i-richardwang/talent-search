import { isValidElement, type ReactNode } from "react";

/*
 * Base UI 的触发器 `render` 成子元素时，要知道那个元素是不是原生 `<button>`。
 * 组件按 `displayName` 识别、不 import 组件本身，浮层与按钮之间因此没有循环依赖。
 * 新写一个渲染原生 `<button>` 的组件要加进名单，并设 `displayName`。
 */

const NATIVE_BUTTON_COMPONENTS = new Set([
	"ActionIcon",
	"ChatInputAction",
	"Button",
	"CopyButton",
	"FilterButton",
	"FilterChipTrigger",
	"ProgressTag",
]);

export function isNativeButtonElement(children: ReactNode): boolean {
	return isValidElement(children) && children.type === "button";
}

/** 交给 Base UI 的 `nativeButton`：显式给的优先；不是元素时交给 Base UI 自己定。 */
export function resolveNativeButton(
	children: ReactNode,
	nativeButton?: boolean,
): boolean | undefined {
	if (nativeButton !== undefined) return nativeButton;
	if (!isValidElement(children)) return undefined;
	if (typeof children.type === "string") return children.type === "button";
	const component = children.type as { displayName?: string };
	return NATIVE_BUTTON_COMPONENTS.has(component.displayName ?? "");
}
