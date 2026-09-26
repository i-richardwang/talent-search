"use client";

import { Menu } from "@base-ui/react/menu";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { animate, motionValue } from "motion";
import {
	type ComponentProps,
	type CSSProperties,
	type Key,
	type ReactElement,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	defaultPortalContainer,
	triggerRender,
} from "#/components/ui/floating";
import { resolveNativeButton } from "#/components/ui/native-button";
import { cn } from "#/lib/utils";

/*
 * 下拉菜单，样式在 dropdown-menu.css。用原子件拼：`DropdownMenuRoot` 里放
 * `DropdownMenuTrigger` 与 `DropdownMenuPortal` › `DropdownMenuPositioner` ›
 * `DropdownMenuPopup`，弹层里放单选项或 `renderDropdownMenuItems` 画出的项。
 * `items` 有四种：普通项、`divider`、`group`、`switch`（开关项）。
 *
 * 开关项里的开关是受控的小号开关：按钮底、滑块、按下时滑块变宽、motion 弹簧
 * （damping 24、stiffness 360）。开关只在菜单里用到，没有单独的 Switch 组件。
 *
 * - 单选项：`DropdownMenuRadioGroup`、`DropdownMenuRadioItemPrimitive`、
 *   `DropdownMenuRadioItemIndicator`，Base UI 的 `Menu.RadioGroup` / `Menu.RadioItem`
 *   给出单选的语义。界面约定单选用 Radio（AGENTS.md「界面验收」），菜单里
 *   几选一的项用它。
 * - 弹层在触发器左下方展开。portal 到 `<body>`；定位器的 z 值是 `--z-index-popup`
 *   这一档，不按打开先后另分配，碰撞边距用 Base UI 的默认（见 floating.ts）。
 * - 触发器不挂类：打开时的底色在 styles.css 的 base 层按
 *   `[aria-haspopup="menu"][data-popup-open]` 选。styles.css 的通用焦点框跳过带 `ui-` 类的
 *   元素，挂上类会让触发器没有焦点框。
 */

interface MenuItemType {
	danger?: boolean;
	key: Key;
	label: string;
	onClick?: () => void;
	type?: undefined;
}

interface MenuItemGroupType {
	children: MenuItemType[];
	label: string;
	type: "group";
}

interface MenuDividerType {
	type: "divider";
}

interface MenuSwitchItemType {
	checked: boolean;
	key: Key;
	label: string;
	onCheckedChange: (checked: boolean) => void;
	type: "switch";
}

export type DropdownItem =
	| MenuItemType
	| MenuItemGroupType
	| MenuDividerType
	| MenuSwitchItemType;

export const DropdownMenuRoot: typeof Menu.Root = (props) => (
	<Menu.Root modal={false} {...props} />
);

export const DropdownMenuRadioGroup = Menu.RadioGroup;
export const DropdownMenuRadioItemIndicator = Menu.RadioItemIndicator;

/** 触发器：子元素是一个按钮，触发器的属性与 ref 合进它本身（见 floating.ts）。 */
export function DropdownMenuTrigger({ children }: { children: ReactElement }) {
	return (
		<Menu.Trigger
			nativeButton={resolveNativeButton(children)}
			render={triggerRender(children)}
		/>
	);
}

export function DropdownMenuPortal({ children }: { children: ReactNode }) {
	return (
		<Menu.Portal container={defaultPortalContainer()}>{children}</Menu.Portal>
	);
}

export function DropdownMenuPositioner({ children }: { children: ReactNode }) {
	return (
		<Menu.Positioner
			align="start"
			className="ui-dropdown-menu-positioner"
			side="bottom"
			sideOffset={6}
		>
			{children}
		</Menu.Positioner>
	);
}

export function DropdownMenuPopup({ children }: { children: ReactNode }) {
	return <Menu.Popup className="ui-dropdown-menu-popup">{children}</Menu.Popup>;
}

/** 固定在菜单项上方的一栏，带分隔线；不是菜单项，键盘走不到，点它也不收起菜单。 */
export function DropdownMenuHeader({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn("ui-dropdown-menu-header", className)}
			data-slot="header"
		>
			{children}
		</div>
	);
}

function DropdownMenuItem({
	danger,
	...rest
}: ComponentProps<typeof Menu.Item> & { danger?: boolean }) {
	return (
		<Menu.Item
			{...rest}
			className={cn(
				"ui-dropdown-menu-item",
				danger && "ui-dropdown-menu-danger",
			)}
		/>
	);
}

/** 单选项，放在 `DropdownMenuRadioGroup` 里。 */
export function DropdownMenuRadioItemPrimitive(
	props: ComponentProps<typeof Menu.RadioItem>,
) {
	return <Menu.RadioItem {...props} className="ui-dropdown-menu-item" />;
}

export function DropdownMenuItemContent({ children }: { children: ReactNode }) {
	return <div className="ui-dropdown-menu-item-content">{children}</div>;
}

/** 项左端的图标位，14px；没有子元素时是一格空位，让文字和别的项对齐。 */
export function DropdownMenuItemIcon({ children }: { children?: ReactNode }) {
	return <span className="ui-dropdown-menu-icon">{children}</span>;
}

export function DropdownMenuItemLabelGroup({
	children,
}: {
	children: ReactNode;
}) {
	return <div className="ui-dropdown-menu-label-group">{children}</div>;
}

export function DropdownMenuItemLabel({ children }: { children: ReactNode }) {
	return <span className="ui-dropdown-menu-label">{children}</span>;
}

export function DropdownMenuItemDesc({ children }: { children: ReactNode }) {
	return <span className="ui-dropdown-menu-desc">{children}</span>;
}

const THUMB_SPRING = { damping: 24, stiffness: 360, type: "spring" as const };

/**
 * 滑块：motion 用弹簧推两个 0 到 1 的量，写成滑块上的 `--switch-on`（开没开）与
 * `--switch-press`（按没按住）；滑块的宽度和位移由 dropdown-menu.css 按开关的几何算出来。
 */
function SwitchThumb({
	checked,
	pressed,
}: {
	checked: boolean;
	pressed: boolean;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const on = checked ? 1 : 0;
	const press = pressed ? 1 : 0;

	const [values] = useState(() => ({
		on: motionValue(on),
		press: motionValue(press),
	}));

	// 两个量只在首次渲染写进 style，之后由 motion 直接写 DOM，React 不会中途改回去。
	const [initialStyle] = useState<CSSProperties>(
		() => ({ "--switch-on": on, "--switch-press": press }) as CSSProperties,
	);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const unsubscribe = (["on", "press"] as const).map((key) =>
			values[key].on("change", (value) => {
				el.style.setProperty(`--switch-${key}`, String(value));
			}),
		);
		return () => {
			for (const stop of unsubscribe) stop();
		};
	}, [values]);

	useEffect(() => {
		const reduceMotion =
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		const transition = reduceMotion ? { duration: 0 } : THUMB_SPRING;
		const animations = [
			animate(values.on, on, transition),
			animate(values.press, press, transition),
		];
		return () => {
			for (const animation of animations) animation.stop();
		};
	}, [values, on, press]);

	return (
		<BaseSwitch.Thumb
			render={
				<span className="ui-switch-thumb" ref={ref} style={initialStyle} />
			}
		/>
	);
}

/** 开关项右端的小号开关：受控，不进 Tab 顺序，点它不再冒泡到菜单项。 */
function MenuSwitch({
	checked,
	onCheckedChange,
}: {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	const [pressed, setPressed] = useState(false);

	return (
		<BaseSwitch.Root
			checked={checked}
			nativeButton
			onCheckedChange={onCheckedChange}
			render={
				<button
					className="ui-switch"
					onClick={(event) => event.stopPropagation()}
					onKeyDown={(event) => {
						if (event.key === " ") setPressed(true);
					}}
					onKeyUp={(event) => {
						if (event.key === " ") setPressed(false);
					}}
					onPointerCancel={() => setPressed(false)}
					onPointerDown={() => setPressed(true)}
					onPointerLeave={() => setPressed(false)}
					onPointerUp={() => setPressed(false)}
					tabIndex={-1}
					type="button"
				/>
			}
		>
			<SwitchThumb checked={checked} pressed={pressed} />
		</BaseSwitch.Root>
	);
}

/** 开关项：点整项切换，菜单不收起。 */
function DropdownMenuSwitchItem({
	checked,
	children,
	label,
	onCheckedChange,
}: {
	checked: boolean;
	children: ReactNode;
	label: string;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<Menu.Item
			className="ui-dropdown-menu-item"
			closeOnClick={false}
			label={label}
			onClick={(event) => {
				event.preventDefault();
				onCheckedChange(!checked);
			}}
		>
			{children}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: 只拦下开关冒上来的焦点事件，不让菜单把它当成移到了这一项 */}
			<span
				onFocus={(event) => event.stopPropagation()}
				style={{ display: "inline-flex", marginInlineStart: 16 }}
			>
				<MenuSwitch checked={checked} onCheckedChange={onCheckedChange} />
			</span>
		</Menu.Item>
	);
}

/** 一项的内容：`reserveIconSpace` 时左边留一格空的图标位，文字与带图标的单选项对齐。 */
const itemContent = (label: string, reserveIconSpace: boolean) => (
	<DropdownMenuItemContent>
		{reserveIconSpace && <DropdownMenuItemIcon />}
		<DropdownMenuItemLabel>{label}</DropdownMenuItemLabel>
	</DropdownMenuItemContent>
);

const renderItem = (item: MenuItemType, reserveIconSpace: boolean) => (
	<DropdownMenuItem
		danger={item.danger}
		key={item.key}
		label={item.label}
		onClick={item.onClick}
	>
		{itemContent(item.label, reserveIconSpace)}
	</DropdownMenuItem>
);

/**
 * 把 `items` 画成菜单项，放进 `DropdownMenuPopup`。`reserveIconSpace` 给每一项留出
 * 图标位，和同一菜单里带勾的单选项对齐。
 */
export const renderDropdownMenuItems = (
	items: DropdownItem[],
	{ reserveIconSpace = false }: { reserveIconSpace?: boolean } = {},
): ReactNode[] =>
	items.map((item, index) => {
		if (item.type === "divider")
			return (
				// biome-ignore lint/suspicious/noArrayIndexKey: 分隔线没有自己的身份，位置就是它的 key
				<Menu.Separator className="ui-dropdown-menu-separator" key={index} />
			);

		if (item.type === "group")
			return (
				// biome-ignore lint/suspicious/noArrayIndexKey: 分组的标签可以重名，位置就是它的 key
				<Menu.Group key={index}>
					<Menu.GroupLabel className="ui-dropdown-menu-group-label">
						{item.label}
					</Menu.GroupLabel>
					{item.children.map((child) => renderItem(child, reserveIconSpace))}
				</Menu.Group>
			);

		if (item.type === "switch")
			return (
				<DropdownMenuSwitchItem
					checked={item.checked}
					key={item.key}
					label={item.label}
					onCheckedChange={item.onCheckedChange}
				>
					{itemContent(item.label, reserveIconSpace)}
				</DropdownMenuSwitchItem>
			);

		return renderItem(item, reserveIconSpace);
	});
