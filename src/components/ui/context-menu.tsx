"use client";

import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import type { ReactNode } from "react";
import { DropdownMenuPopup, DropdownMenuPortal } from "./dropdown-menu";

/*
 * 右键菜单：`children` 那一块上按右键（触屏上长按）时，在指针处打开 `menu`。项用下拉菜单
 * 那一套，没有展开动画。触发区不占版面，包住的元素照常排；里面再有右键菜单时，按在里面
 * 那一块上只开里面那一个。
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
