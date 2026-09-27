import type { ComponentProps } from "react";
import type { ActionIcon } from "#/components/ui/action-icon";
import type { ButtonProps } from "#/components/ui/button";
import type { InputSize } from "#/components/ui/input";
import type { Segmented } from "#/components/ui/segmented";
import type { Table } from "#/components/ui/table";
import type { Tabs } from "#/components/ui/tabs";
import type { Tag } from "#/components/ui/tag";
import { requirePage } from "../catalog";

/*
 * 设计系统能调的令牌：颜色、数值（尺寸与时长）、缓动。默认值不存在这里，
 * 只从源文件读（见 `css.ts` 的 `readSource`）；这里定每个令牌叫什么、能取什么值。
 */

export type Theme = "light" | "dark";
/** 改动作用在哪一侧：两种外观各自的颜色，或两种外观共用的其余令牌。 */
export type Scope = Theme | "shared";

export const THEMES = ["light", "dark"] as const;
export const SCOPE_LABEL: Record<Scope, string> = {
	dark: "深色",
	light: "浅色",
	shared: "共用",
};

interface ColorGroup {
	id: string;
	title: string;
	tokens: [key: string, label: string][];
}

/** 颜色令牌，按用途分组；颜色页照这个顺序画。 */
export const COLOR_GROUPS: ColorGroup[] = [
	{
		id: "surfaces",
		title: "底与容器",
		tokens: [
			["--color-layout", "页面底色"],
			["--color-container", "容器底色"],
			["--color-elevated", "浮层底色"],
			["--color-mask-drawer", "抽屉遮罩"],
			["--color-shadow", "阴影色"],
		],
	},
	{
		id: "content",
		title: "文字与图标",
		tokens: [
			["--color-fg", "正文"],
			["--color-fg-secondary", "次要文字"],
			["--color-fg-tertiary", "辅助文字"],
			["--color-fg-quaternary", "禁用与占位"],
		],
	},
	{
		id: "fills",
		title: "填充",
		tokens: [
			["--color-fill", "一级填充"],
			["--color-fill-secondary", "二级填充"],
			["--color-fill-tertiary", "三级填充"],
			["--color-fill-quaternary", "四级填充"],
		],
	},
	{
		id: "lines",
		title: "描边",
		tokens: [
			["--color-border", "边框"],
			["--color-border-secondary", "分隔线"],
			["--color-split", "细分隔线"],
			["--color-ring", "浮层外沿"],
			["--color-selection", "选中文字底色"],
		],
	},
	{
		id: "primary",
		title: "主色",
		tokens: [
			["--color-primary", "主色"],
			["--color-primary-hover", "主色悬停"],
			["--color-primary-active", "主色按下"],
			["--color-primary-bg", "主色浅底"],
			["--color-primary-bg-hover", "主色浅底悬停"],
			["--color-primary-border", "主色边框"],
		],
	},
	{
		id: "status",
		title: "状态色",
		tokens: [
			["--color-success", "成功"],
			["--color-success-fill-tertiary", "成功三级填充"],
			["--color-warning", "警告"],
			["--color-warning-fill-tertiary", "警告三级填充"],
			["--color-error", "错误"],
			["--color-error-hover", "错误悬停"],
			["--color-error-active", "错误按下"],
			["--color-error-bg", "错误浅底"],
			["--color-error-bg-hover", "错误浅底悬停"],
			["--color-error-fill-tertiary", "错误三级填充"],
			["--color-info", "信息"],
			["--color-info-hover", "信息悬停"],
			["--color-info-active", "信息按下"],
			["--color-info-fill-tertiary", "信息三级填充"],
		],
	},
];

export const COLOR_TOKENS = COLOR_GROUPS.flatMap((group) => group.tokens);
const COLOR_LABEL = new Map(COLOR_TOKENS);
export const isColorToken = (key: unknown): key is string =>
	typeof key === "string" && COLOR_LABEL.has(key);

/**
 * 投影令牌：写在 `styles.css`，深浅两侧各一份，设计系统只展示不调。用途与
 * 那里的注释一致，写的是每一档实际的读者。
 */
export const SHADOW_TOKENS: { key: string; label: string; use: string }[] = [
	{ key: "--elevation-sm", label: "小投影", use: "提示气泡、选项卡的指示块" },
	{ key: "--elevation-md", label: "中投影", use: "下拉菜单、弹出层" },
	{ key: "--elevation-lg", label: "大投影", use: "对话框" },
	{
		key: "--elevation-chat-input",
		label: "输入托盘投影",
		use: "输入托盘底下一层短投影",
	},
	{
		key: "--elevation-chat-input-large",
		label: "大号输入托盘投影",
		use: "首页 large 输入托盘托着的一层远影",
	},
	{
		key: "--elevation-edge",
		label: "描边投影",
		use: "贴着描边的一层细投影：工具栏与带 shadow 的 Block",
	},
	{
		key: "--elevation-drawer-left",
		label: "左侧抽屉投影",
		use: "贴左边的抽屉面板朝内容一侧投的影",
	},
	{
		key: "--elevation-drawer-right",
		label: "右侧抽屉投影",
		use: "贴右边的抽屉面板朝内容一侧投的影",
	},
	{
		key: "--elevation-switch-track",
		label: "开关轨道",
		use: "菜单里开关关着时轨道的内凹",
	},
	{
		key: "--elevation-switch-track-checked",
		label: "开关轨道（开）",
		use: "菜单里开关开着时轨道的内凹",
	},
	{
		key: "--elevation-switch-thumb",
		label: "开关滑块",
		use: "菜单里开关滑块的浮起",
	},
	{
		key: "--elevation-switch-thumb-hover",
		label: "开关滑块（悬停）",
		use: "指针停在开关上时滑块的浮起",
	},
];

/** 组件尺寸的档，从小到大。 */
export type SizeTier = "small" | "middle" | "large";
export const SIZE_TIERS: SizeTier[] = ["small", "middle", "large"];
export const TIER_LABEL: Record<SizeTier, string> = {
	large: "大",
	middle: "中",
	small: "小",
};

/** 一个组件 `size` 属性接受的档（数字尺寸不算档）。 */
type TiersOf<Size> = Extract<NonNullable<Size>, SizeTier>;

/** 列出一个组件的全部档：少列、多列都过不了类型检查。 */
const tiersOf =
	<Size>() =>
	<const Tiers extends readonly TiersOf<Size>[]>(
		tiers: Tiers &
			([TiersOf<Size>] extends [Tiers[number]] ? unknown : "少列了档"),
	) =>
		tiers;

/**
 * 有组件令牌的组件和各自的档：令牌名以组件名开头，声明在 `src/components/ui/<它>.css`
 * 的 `:root` 上，每档一份。每个组件都有中档，它是组件不传 size 时的尺寸。
 * 档从组件 `size` 属性的类型核对，组件加一档或删一档，这里跟着改才过得了类型检查。
 */
export const COMPONENT_TIERS = {
	"action-icon": tiersOf<ComponentProps<typeof ActionIcon>["size"]>()([
		"small",
		"middle",
	]),
	button: tiersOf<ButtonProps["size"]>()(["small", "middle", "large"]),
	input: tiersOf<InputSize>()(["small", "middle"]),
	segmented: tiersOf<ComponentProps<typeof Segmented>["size"]>()([
		"small",
		"middle",
	]),
	table: tiersOf<ComponentProps<typeof Table>["size"]>()([
		"small",
		"middle",
		"large",
	]),
	tabs: tiersOf<ComponentProps<typeof Tabs>["size"]>()(["small", "middle"]),
	tag: tiersOf<ComponentProps<typeof Tag>["size"]>()([
		"small",
		"middle",
		"large",
	]),
};

export type ComponentSizing = keyof typeof COMPONENT_TIERS;
/** 一个组件有的档。 */
export type TierOf<G extends ComponentSizing> =
	(typeof COMPONENT_TIERS)[G][number];

/** 有组件令牌的组件的中文名：目录里这个组件那一页的标题。 */
export function componentLabel(group: ComponentSizing): string {
	return requirePage(`components/${group}`).title;
}

/** 数值令牌在源文件里的单位；`rem` 在编辑器里按像素调。 */
type NumericUnit = "px" | "rem" | "ms";

/** 数值令牌：尺寸（圆角、字号、版心、组件尺寸）与进出场时长。 */
export interface NumericToken {
	key: string;
	label: string;
	group: "radius" | "type" | "layout" | "motion" | ComponentSizing;
	/** 数值框前面的符号。 */
	symbol: string;
	/** 编辑器里的范围与步长，单位见 `editUnit`。 */
	min: number;
	max: number;
	step: number;
	unit: NumericUnit;
	/** 组件令牌属于哪一档；不分档的没有。 */
	size?: SizeTier;
	/** 时长令牌作用在哪些弹层上。 */
	overlays?: readonly Overlay[];
}

/** 编辑器里显示和输入的单位：尺寸一律像素，时长毫秒。 */
export const editUnit = (token: NumericToken) =>
	token.unit === "ms" ? "ms" : "px";

/**
 * 源文件写法读成编辑器里的数：`rem` 按 16px 换成像素，`px`、`ms` 取数本身。
 * 单位不是这个令牌的单位、或写得不对时返回 undefined。
 */
export function parseNumeric(
	token: NumericToken,
	raw: string,
): number | undefined {
	const match = new RegExp(`^(\\d*\\.?\\d+)${token.unit}$`).exec(raw.trim());
	if (!match) return undefined;
	const value = Number(match[1]);
	return token.unit === "rem" ? value * 16 : value;
}

/** 读一个一定合规的值（原版或校验过的修改版）；读不懂说明源文件写错了。 */
export function numericValue(token: NumericToken, raw: string): number {
	const value = parseNumeric(token, raw);
	if (value === undefined)
		throw new Error(`${token.key} 的值 ${raw} 不是 ${token.unit}`);
	return value;
}

/** 编辑器里的数写回源文件的写法：`rem` 令牌写成 `x.xxxxrem`，其余带上单位。 */
export function formatNumeric(token: NumericToken, value: number): string {
	return token.unit === "rem"
		? `${Number((value / 16).toFixed(4))}rem`
		: `${value}${token.unit}`;
}

const rem = (
	key: string,
	label: string,
	group: "radius" | "type" | "layout",
	min: number,
	max: number,
): NumericToken => ({
	group,
	key,
	label,
	max,
	min,
	step: 1,
	symbol:
		group === "radius"
			? "⌜"
			: key.endsWith("height")
				? "↕"
				: group === "layout"
					? "↔"
					: "T",
	unit: "rem",
});

type Part = [
	name: string,
	label: string,
	symbol: string,
	min: number,
	max: number,
];

/** 一个组件每档各一份的令牌：`--<组件>-<名字>-<档>`。 */
const tiered = (group: ComponentSizing, parts: Part[]): NumericToken[] =>
	COMPONENT_TIERS[group].flatMap((size) =>
		parts.map(([name, label, symbol, min, max]) => ({
			group,
			key: `--${group}-${name}-${size}`,
			label,
			max,
			min,
			size,
			step: 1,
			symbol,
			unit: "px" as const,
		})),
	);

const HEIGHT: Part = ["height", "高度", "H", 16, 56];
const PADDING: Part = ["padding", "水平内边距", "↔", 0, 32];
const FONT_SIZE: Part = ["font-size", "字号", "T", 10, 20];

/** 对话框与抽屉：两种弹层各有一对进出场时长，遮罩两者共用。 */
export type Overlay = "modal" | "drawer";

const duration = (
	key: string,
	label: string,
	symbol: string,
	overlays: readonly Overlay[],
): NumericToken => ({
	group: "motion",
	key,
	label,
	max: 2000,
	min: 0,
	overlays,
	step: 10,
	symbol,
	unit: "ms",
});

export const NUMERIC_TOKENS: NumericToken[] = [
	rem("--radius-xs", "特小圆角", "radius", 0, 12),
	rem("--radius-sm", "小圆角", "radius", 0, 16),
	rem("--radius-md", "基础圆角", "radius", 0, 20),
	rem("--radius-lg", "大圆角", "radius", 0, 28),
	rem("--radius-xl", "特大圆角", "radius", 0, 40),
	rem("--text-xs", "小号字", "type", 10, 14),
	rem("--text-xs--line-height", "小号字行高", "type", 14, 26),
	rem("--text-sm", "控件字", "type", 11, 15),
	rem("--text-sm--line-height", "控件字行高", "type", 14, 26),
	rem("--text-base", "正文", "type", 12, 18),
	rem("--text-base--line-height", "正文行高", "type", 16, 30),
	rem("--text-lg", "大号字", "type", 14, 20),
	rem("--text-lg--line-height", "大号字行高", "type", 18, 32),
	rem("--text-xl", "小标题", "type", 16, 28),
	rem("--text-xl--line-height", "小标题行高", "type", 20, 36),
	rem("--text-2xl", "标题", "type", 18, 32),
	rem("--text-2xl--line-height", "标题行高", "type", 24, 40),
	rem("--container-page", "版心", "layout", 576, 960),
	rem("--container-nav", "导航栏", "layout", 200, 360),
	rem("--container-detail", "抽屉", "layout", 320, 640),
	rem("--container-detail-wide", "宽抽屉", "layout", 320, 704),
	rem("--container-log", "日志抽屉", "layout", 480, 960),
	rem("--container-admin", "管理页内容列", "layout", 768, 1280),
	rem("--nav-header-height", "页头高度", "layout", 36, 56),
	rem("--nav-header-action-size", "页头按钮", "layout", 24, 36),
	duration("--duration-modal-enter", "对话框进场", "↦", ["modal"]),
	duration("--duration-modal-exit", "对话框退场", "↤", ["modal"]),
	duration("--duration-drawer-enter", "抽屉进场", "↦", ["drawer"]),
	duration("--duration-drawer-exit", "抽屉退场", "↤", ["drawer"]),
	duration("--duration-backdrop", "遮罩淡入淡出", "◐", ["modal", "drawer"]),
	duration("--duration-panel-fold", "面板展开收起", "⇔", []),
	...tiered("button", [HEIGHT, PADDING, FONT_SIZE]),
	{
		group: "button",
		key: "--button-gap",
		label: "图文间距",
		max: 16,
		min: 0,
		step: 1,
		symbol: "⋮",
		unit: "px",
	},
	...tiered("action-icon", [["size", "方块边长", "□", 16, 64]]),
	...tiered("input", [HEIGHT, PADDING, FONT_SIZE]),
	...tiered("segmented", [HEIGHT, PADDING, FONT_SIZE]),
	...tiered("tabs", [HEIGHT, PADDING, FONT_SIZE]),
	...tiered("tag", [
		["height", "高度", "H", 14, 40],
		["padding", "水平内边距", "↔", 0, 24],
		["padding-round", "圆形水平内边距", "↔", 0, 24],
	]),
	...tiered("table", [
		["padding-block", "单元格纵向内边距", "↕", 0, 32],
		["padding-inline", "单元格横向内边距", "↔", 0, 32],
	]),
	{
		group: "table",
		key: "--table-padding-edge",
		label: "首尾两列离外框",
		max: 32,
		min: 0,
		step: 1,
		symbol: "⇤",
		unit: "px",
	},
];

export const numericToken = (key: string): NumericToken | undefined =>
	NUMERIC_TOKENS.find((token) => token.key === key);

/** 一组数值令牌。 */
export const numericTokens = (group: NumericToken["group"]) =>
	NUMERIC_TOKENS.filter((token) => token.group === group);

export interface EasingToken {
	key: string;
	label: string;
	/** 读它的弹层；只用在别处的曲线没有。 */
	overlays: readonly Overlay[];
}

/** 缓动曲线：状态过渡一条，面板进场、退场各一条，小件出现一条。 */
export const EASING_TOKENS: EasingToken[] = [
	{ key: "--ease-out", label: "状态过渡", overlays: [] },
	{ key: "--ease-soft", label: "进场与按压", overlays: ["modal", "drawer"] },
	{ key: "--ease-accelerate", label: "退场", overlays: ["modal", "drawer"] },
	{ key: "--ease-snap", label: "小件出现", overlays: [] },
];

/** 缓动的可选值；每个缓动令牌的默认值都在其中。 */
export const EASINGS: [value: string, label: string][] = [
	["cubic-bezier(0.215, 0.61, 0.355, 1)", "缓出"],
	["cubic-bezier(0.32, 0.72, 0, 1)", "柔和"],
	["cubic-bezier(0.4, 0, 1, 1)", "加速"],
	["cubic-bezier(0.22, 1, 0.36, 1)", "急停"],
	["linear", "线性"],
];

/** 一页演示哪些动效：一种弹层，或全部动效令牌。 */
export type MotionScope = Overlay | "all";

/** 一页右栏「动效」一节列的时长与缓动。 */
export function motionTokens(scope: MotionScope) {
	const shown = (overlays: readonly Overlay[] = []) =>
		scope === "all" || overlays.includes(scope);
	return {
		durations: numericTokens("motion").filter((token) => shown(token.overlays)),
		easings: EASING_TOKENS.filter((token) => shown(token.overlays)),
	};
}

/** 共用一侧的一个值能不能写进这个令牌：缓动是可选值之一，数值写法对、在范围里。 */
export function isSharedValue(key: string, raw: string): boolean {
	if (EASING_TOKENS.some((token) => token.key === key))
		return EASINGS.some(([easing]) => easing === raw);
	const token = numericToken(key);
	if (!token) return false;
	const value = parseNumeric(token, raw);
	return value !== undefined && value >= token.min && value <= token.max;
}

/** 数值令牌的中文名；组件令牌带上组件名和档。 */
function numericLabel(token: NumericToken): string {
	if (
		token.group === "radius" ||
		token.group === "type" ||
		token.group === "layout" ||
		token.group === "motion"
	)
		return token.label;
	const component = componentLabel(token.group);
	return token.size
		? `${TIER_LABEL[token.size]}号${component}${token.label}`
		: `${component}${token.label}`;
}

/** 一个令牌的中文名；不在表里的原样返回变量名。 */
export function tokenLabel(key: string): string {
	const numeric = numericToken(key);
	return (
		COLOR_LABEL.get(key) ??
		(numeric && numericLabel(numeric)) ??
		EASING_TOKENS.find((token) => token.key === key)?.label ??
		key
	);
}
