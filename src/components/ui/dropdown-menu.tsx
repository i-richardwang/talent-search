"use client";

import { Menu } from "@base-ui/react/menu";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { CheckIcon, type LucideIcon } from "lucide-react";
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
import { Icon } from "#/components/ui/icon";
import { resolveNativeButton } from "#/components/ui/native-button";
import { cn } from "#/lib/utils";

/*
 * 下拉菜单，用原子件拼：`DropdownMenuRoot` 里放 `DropdownMenuTrigger` 与
 * `DropdownMenuPortal` › `DropdownMenuPositioner` › `DropdownMenuPopup`，弹层里放单选项或
 * `renderDropdownMenuItems` 画出的项。菜单里有一项带图标，其余项都留出同样的图标位，
 * 文字对齐。勾选项和单选项点了菜单不收起，可以接着勾。开关只在菜单里用到，没有单独的
 * Switch 组件。
 *
 * 触发器不挂类：打开时的底色在 styles.css 的 base 层按 `[aria-haspopup="menu"][data-popup-open]`
 * 选。styles.css 的通用焦点框跳过带 `ui-` 类的元素，挂上类会让触发器没有焦点框。
 */

interface MenuItemType {
	danger?: boolean;
	icon?: LucideIcon;
	key: Key;
	label: string;
	onClick?: () => void;
	type?: undefined;
}

interface MenuCheckboxItemType {
	checked: boolean;
	disabled?: boolean;
	extra?: ReactNode;
	key: Key;
	label: string;
	onCheckedChange: (checked: boolean) => void;
	type: "checkbox";
}

interface MenuRadioGroupType {
	onValueChange: (value: string) => void;
	options: {
		disabled?: boolean;
		extra?: ReactNode;
		label: string;
		value: string;
	}[];
	type: "radio";
	value: string;
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
	| MenuSwitchItemType
	| MenuCheckboxItemType
	| MenuRadioGroupType;

export const DropdownMenuRoot: typeof Menu.Root = (props) => (
	<Menu.Root modal={false} {...props} />
);

export const DropdownMenuRadioGroup = Menu.RadioGroup;
export const DropdownMenuSubmenuRoot = Menu.SubmenuRoot;
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

/** 定位器。`submenu` 时贴着那一项的右边，上沿抵掉弹层的内边距，和那一项齐平。 */
export function DropdownMenuPositioner({
	children,
	submenu = false,
}: {
	children: ReactNode;
	submenu?: boolean;
}) {
	return (
		<Menu.Positioner
			className="ui-dropdown-menu-positioner"
			data-submenu={submenu || undefined}
			{...(submenu
				? { alignOffset: -4, sideOffset: -1 }
				: { align: "start", side: "bottom", sideOffset: 6 })}
		>
			{children}
		</Menu.Positioner>
	);
}

export function DropdownMenuPopup({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<Menu.Popup className={cn("ui-dropdown-menu-popup", className)}>
			{children}
		</Menu.Popup>
	);
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

/** 打开子菜单的那一项，放在 `DropdownMenuSubmenuRoot` 里。 */
export function DropdownMenuSubmenuTrigger(
	props: Omit<ComponentProps<typeof Menu.SubmenuTrigger>, "className">,
) {
	return <Menu.SubmenuTrigger {...props} className="ui-dropdown-menu-item" />;
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

/** 项左端的图标位；没有子元素时是一格空位，让文字和别的项对齐。 */
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

/** 项行尾的一个值，例如子菜单里选中的是哪个。 */
export function DropdownMenuItemExtra({ children }: { children: ReactNode }) {
	return <span className="ui-dropdown-menu-extra">{children}</span>;
}

export function DropdownMenuSubmenuArrow() {
	return (
		<span className="ui-dropdown-menu-submenu-arrow">
			<svg
				aria-hidden="true"
				fill="currentColor"
				stroke="currentColor"
				strokeLinejoin="round"
				strokeWidth={1.5}
				viewBox="0 0 16 16"
			>
				<path d="M6 5l4 3-4 3z" />
			</svg>
		</span>
	);
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

/** 开关项右端的开关：不进 Tab 顺序，点它不冒泡到菜单项。 */
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
				className="ui-dropdown-menu-switch"
				onFocus={(event) => event.stopPropagation()}
			>
				<MenuSwitch checked={checked} onCheckedChange={onCheckedChange} />
			</span>
		</Menu.Item>
	);
}

/**
 * 一项的内容：图标位里画 `lead`（图标，或勾选项、单选项的勾）；`reserveIconSpace` 时
 * 没有也留一格空的图标位。`extra` 排在行尾。
 */
const itemContent = (
	label: string,
	reserveIconSpace: boolean,
	lead?: ReactNode,
	extra?: ReactNode,
) => (
	<DropdownMenuItemContent>
		{(lead || reserveIconSpace) && (
			<DropdownMenuItemIcon>{lead}</DropdownMenuItemIcon>
		)}
		<DropdownMenuItemLabel>{label}</DropdownMenuItemLabel>
		{extra !== undefined && (
			<DropdownMenuItemExtra>{extra}</DropdownMenuItemExtra>
		)}
	</DropdownMenuItemContent>
);

const renderItem = (item: MenuItemType, reserveIconSpace: boolean) => (
	<DropdownMenuItem
		danger={item.danger}
		key={item.key}
		label={item.label}
		onClick={item.onClick}
	>
		{itemContent(
			item.label,
			reserveIconSpace,
			item.icon && <Icon icon={item.icon} />,
		)}
	</DropdownMenuItem>
);

const CHECK = <Icon icon={CheckIcon} />;

const renderCheckboxItem = (item: MenuCheckboxItemType) => (
	<Menu.CheckboxItem
		checked={item.checked}
		className="ui-dropdown-menu-item"
		disabled={item.disabled}
		key={item.key}
		label={item.label}
		onCheckedChange={item.onCheckedChange}
	>
		{itemContent(
			item.label,
			true,
			<Menu.CheckboxItemIndicator render={<span />}>
				{CHECK}
			</Menu.CheckboxItemIndicator>,
			item.extra,
		)}
	</Menu.CheckboxItem>
);

const renderRadioGroup = (item: MenuRadioGroupType, index: number) => (
	<Menu.RadioGroup
		key={index}
		onValueChange={(value) => item.onValueChange(value as string)}
		value={item.value}
	>
		{item.options.map((option) => (
			<Menu.RadioItem
				className="ui-dropdown-menu-item"
				disabled={option.disabled}
				key={option.value}
				label={option.label}
				value={option.value}
			>
				{itemContent(
					option.label,
					true,
					<Menu.RadioItemIndicator render={<span />}>
						{CHECK}
					</Menu.RadioItemIndicator>,
					option.extra,
				)}
			</Menu.RadioItem>
		))}
	</Menu.RadioGroup>
);

/** 这一组项里有没有占图标位的：带图标的项、勾选项、单选项（分组里的也算）。 */
const hasAnyIcon = (items: DropdownItem[]): boolean =>
	items.some((item) =>
		item.type === "group"
			? hasAnyIcon(item.children)
			: item.type === "checkbox" ||
				item.type === "radio" ||
				(item.type === undefined && Boolean(item.icon)),
	);

/**
 * 把 `items` 画成菜单项，放进 `DropdownMenuPopup`。`reserveIconSpace` 在没有图标时也留出
 * 图标位，和同一菜单里带勾的单选项对齐。
 */
export const renderDropdownMenuItems = (
	items: DropdownItem[],
	{ reserveIconSpace = hasAnyIcon(items) }: { reserveIconSpace?: boolean } = {},
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

		if (item.type === "checkbox") return renderCheckboxItem(item);

		if (item.type === "radio") return renderRadioGroup(item, index);

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
