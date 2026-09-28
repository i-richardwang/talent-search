import { isValidElement, type ReactNode } from "react";

/*
 * Base UI 的触发器 `render` 成子元素时，要知道那个元素是不是原生 `<button>`。
 * 渲染原生 `<button>` 的组件按名字（`displayName`）认，不 import 组件本身，
 * 浮层组件与按钮组件之间因此没有循环依赖。名单外的组件当作不是按钮。
 */

const NATIVE_BUTTON_COMPONENTS = new Set([
	"ActionIcon",
	"Button",
	"CopyButton",
	"FilterButton",
	"FilterChipTrigger",
	"ProgressTag",
]);

/** 子元素是不是字面写的 `<button>`。 */
export function isNativeButtonElement(children: ReactNode): boolean {
	return isValidElement(children) && children.type === "button";
}

/**
 * 交给 Base UI 的 `nativeButton`：显式给的优先；不是元素时交给 Base UI 自己定；
 * 字面的 `<button>` 与名单里的组件是，其余不是。
 */
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
