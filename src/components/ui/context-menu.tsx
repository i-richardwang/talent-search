"use client";

import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import type { ReactNode } from "react";
import { DropdownMenuPopup, DropdownMenuPortal } from "./dropdown-menu";

/*
 * 右键菜单，样式在 context-menu.css。`children` 那一块上按右键（触屏上长按）时，在指针处
 * 打开 `menu`：弹层、项、分隔线、子菜单都是下拉菜单那一套（`renderDropdownMenuItems`
 * 与 `DropdownMenu*` 原子件），长相和「…」打开的菜单一样，只是没有展开动画。
 *
 * 触发区是一层不占版面的 `div`（`display: contents`），包住的元素照常排；里面再有
 * 右键菜单时，按在里面那一块上只开里面那一个。
 */
export function ContextMenu({
	menu,
	children,
}: {
	/** 弹层里的项：`renderDropdownMenuItems(...)` 或下拉菜单的原子件。 */
	menu: ReactNode;
	children: ReactNode;
}) {
	return (
		<BaseContextMenu.Root>
			<BaseContextMenu.Trigger className="ui-context-menu-trigger">
				{children}
			</BaseContextMenu.Trigger>
			<DropdownMenuPortal>
				<BaseContextMenu.Positioner
					className="ui-dropdown-menu-positioner ui-context-menu-positioner"
					sideOffset={6}
				>
					<DropdownMenuPopup>{menu}</DropdownMenuPopup>
				</BaseContextMenu.Positioner>
			</DropdownMenuPortal>
		</BaseContextMenu.Root>
	);
}
