import {
	BriefcaseBusiness,
	Component,
	History,
	LayoutPanelLeft,
	type LucideIcon,
	Palette,
	Workflow,
} from "lucide-react";
import type { ComponentSizing, MotionScope } from "./tokens/registry";

/*
 * 设计系统的目录：每一页的事实都写在这里，导航、总览、路由、页头、右栏、使用规则的
 * 源文件与「影响范围」都从这里读。页的身份是 `模块/页`（如 `components/button`），
 * 和地址 `#/components/button` 一致；预览页按它找这一页画什么（`preview/pages/index.ts`），
 * 那张表按目录定类型，两边多一项或少一项都过不了类型检查。
 */

/** 右栏完整列出的令牌组：`layout` 多一节版心与栏高，`type` 的文字一节列全部字阶。 */
type TokenGroup = "layout" | "type";

interface PageShape {
	/** 模块里的页名，地址的最后一段。 */
	slug: string;
	title: string;
	/** 页上演示的那个导出，在页头和右栏里跟在标题后面。 */
	name?: string;
	/** 这一页演示的源文件；使用规则、右栏的本页颜色与影响范围读它。 */
	source?: readonly string[];
	/** 没有源文件的页，右栏先列的颜色。 */
	colors?: readonly string[];
	/** 右栏调哪个组件的尺寸令牌。 */
	sizing?: ComponentSizing;
	/** 有进出场可放：预览框多一条放动画的工具条，右栏多一节动效。 */
	motion?: MotionScope;
	tokenGroups?: readonly TokenGroup[];
	/** 右栏换成编辑选中的那一个颜色，预览里点色块选颜色。 */
	colorPicker?: true;
}

/**
 * 模块的内容：`document` 是预览页里带页头的说明页，`screen` 是预览页里的一整屏产品界面，
 * `changes` 是外壳自己画的修改管理页。
 */
type ModuleContent = "document" | "screen" | "changes";

interface ModuleShape {
	id: string;
	title: string;
	description: string;
	icon: LucideIcon;
	content: ModuleContent;
	pages: readonly PageShape[];
}

const ui = (file: string) => `src/components/ui/${file}.tsx`;

const component = <Slug extends string>(
	slug: Slug,
	title: string,
	name: string,
	extra: Omit<PageShape, "slug" | "title" | "name" | "source"> = {},
) => ({ ...extra, name, slug, source: [ui(slug)], title });

const CATALOG = [
	{
		content: "document",
		description: "颜色、字体、间距与版心、圆角、阴影、图标与动效。",
		icon: Palette,
		id: "foundations",
		pages: [
			{ colorPicker: true, slug: "colors", title: "颜色" },
			{
				colors: ["--color-fg", "--color-fg-secondary", "--color-fg-tertiary"],
				slug: "typography",
				title: "字体",
				tokenGroups: ["type"],
			},
			{
				colors: [
					"--color-layout",
					"--color-container",
					"--color-border-secondary",
				],
				slug: "spacing",
				title: "间距与版心",
				tokenGroups: ["layout"],
			},
			{
				colors: ["--color-container", "--color-border"],
				slug: "radius",
				title: "圆角",
			},
			{
				colors: [
					"--color-container",
					"--color-border",
					"--color-border-secondary",
					"--color-shadow",
				],
				slug: "shadows",
				title: "阴影",
			},
			{
				name: "Icon",
				slug: "icons",
				source: [ui("icon")],
				title: "图标",
			},
			{
				colors: [
					"--color-elevated",
					"--color-fg",
					"--color-container",
					"--color-mask-drawer",
				],
				motion: "all",
				name: "Modal · Drawer",
				slug: "motion",
				title: "动效",
			},
		],
		title: "设计基础",
	},
	{
		content: "document",
		description: "按钮、输入、选择、浮层与展示，每个组件的外观、尺寸与状态。",
		icon: Component,
		id: "components",
		pages: [
			{
				colors: [
					"--color-layout",
					"--color-container",
					"--color-elevated",
					"--color-fill-tertiary",
					"--color-primary-bg",
					"--color-primary",
				],
				slug: "gallery",
				title: "组件总览",
			},
			component("button", "按钮", "Button", { sizing: "button" }),
			component("action-icon", "图标按钮", "ActionIcon", {
				sizing: "action-icon",
			}),
			component("icon", "图标", "Icon"),
			component("text", "文字", "Text"),
			component("tag", "标签", "Tag", { sizing: "tag" }),
			component("hotkey", "快捷键", "Hotkey"),
			component("input", "输入框", "Input", { sizing: "input" }),
			component("auto-complete", "自动补全", "AutoComplete", {
				sizing: "input",
			}),
			component("search-bar", "搜索框", "SearchBar"),
			component("chat-input", "输入托盘", "ChatInput"),
			component("checkbox", "复选框", "Checkbox"),
			component("radio", "单选框", "Radio"),
			component("segmented", "分段控制器", "Segmented", {
				sizing: "segmented",
			}),
			component("tabs", "选项卡", "Tabs", { sizing: "tabs" }),
			component("form", "表单", "Form"),
			component("table", "表格", "Table", { sizing: "table" }),
			component("block", "块", "Block"),
			component("flex", "弹性布局", "Flexbox"),
			component("app-layout", "应用外壳", "AppLayout"),
			component("nav-item", "导航项", "NavItem"),
			component("divider", "分割线", "Divider"),
			component("text-link", "文字链接", "TextLink"),
			component("descriptions", "属性列表", "Descriptions"),
			component("list", "列表", "List"),
			component("avatar", "头像", "Avatar"),
			component("scroll-area", "滚动区", "ScrollArea"),
			component("toolbar", "工具条", "Toolbar"),
			component("collapsible", "折叠面板", "Collapsible"),
			component("accordion", "手风琴", "Accordion"),
			component("collapse", "分组卡片", "Collapse"),
			component("empty", "空状态", "Empty"),
			component("skeleton", "骨架屏", "Skeleton"),
			component("alert", "警告提示", "Alert"),
			component("code-block", "代码块", "CodeBlock"),
			component("copy-button", "复制按钮", "CopyButton"),
			component("tooltip", "文字提示", "Tooltip"),
			component("popover", "气泡卡片", "Popover"),
			component("toast", "通知", "Toaster · toast"),
			component("dropdown-menu", "下拉菜单", "DropdownMenuRoot"),
			component("choice-menu", "几选一菜单", "ChoiceMenu"),
			component("modal", "对话框", "Modal", { motion: "modal" }),
			component("drawer", "抽屉", "Drawer", { motion: "drawer" }),
		],
		title: "基础组件",
	},
	{
		content: "document",
		description:
			"用组件搭出来的产品流程：写需求、搜索条件与筛选、挑选与导出、查看详情，以及加载、空态与报错。",
		icon: Workflow,
		id: "patterns",
		pages: [
			{
				slug: "query-input",
				source: [
					"src/components/query-bar.tsx",
					"src/components/keyword-bar.tsx",
					"src/routes/-components/zero-state.tsx",
					"src/routes/-components/home-screen.tsx",
				],
				title: "写需求",
			},
			{
				slug: "conditions",
				source: [
					"src/routes/s/$turnId/-components/query-chips.tsx",
					"src/routes/s/$turnId/-components/filter-panel.tsx",
				],
				title: "搜索条件与筛选",
			},
			{
				slug: "picking",
				source: ["src/routes/s/$turnId/-components/pick-dock.tsx"],
				title: "挑选与导出",
			},
			{
				slug: "reading",
				source: [
					"src/routes/-components/detail-drawer.tsx",
					"src/routes/data/-components/employee-drawer.tsx",
					"src/routes/skills/-components/term-drawer.tsx",
					"src/routes/tasks/-components/task-card.tsx",
					"src/routes/s/$turnId/-components/person.tsx",
				],
				title: "查看详情",
			},
			{
				slug: "states",
				source: [
					"src/routes/s/$turnId/-components/result-state.tsx",
					"src/routes/-components/not-found.tsx",
				],
				title: "加载、空态与报错",
			},
		],
		title: "组合模式",
	},
	{
		content: "document",
		description: "人才搜索自己的组件：证据、经历、名单、对话与状态。",
		icon: BriefcaseBusiness,
		id: "product",
		pages: [
			{
				name: "EvidenceLine",
				slug: "evidence",
				source: ["src/components/evidence.tsx"],
				title: "证据行",
			},
			{
				name: "CareerBar",
				slug: "career-bar",
				source: ["src/components/career-bar.tsx"],
				title: "职业轨迹条",
			},
			{
				name: "Timeline",
				slug: "timeline",
				source: ["src/components/timeline.tsx"],
				title: "经历时间线",
			},
			{
				name: "ResultList",
				slug: "result-list",
				source: ["src/routes/s/$turnId/-components/result-list.tsx"],
				title: "名单",
			},
			{
				name: "Thread",
				slug: "thread",
				source: ["src/routes/s/$turnId/-components/thread.tsx"],
				title: "对话线程",
			},
			{
				name: "StatusBadge",
				slug: "status-badge",
				source: ["src/routes/-components/status-badge.tsx"],
				title: "状态徽章",
			},
		],
		title: "业务组件",
	},
	{
		content: "screen",
		description: "整页的结构：首页、搜索工作台、人的详情与管理页。",
		icon: LayoutPanelLeft,
		id: "layouts",
		pages: [
			{
				slug: "home",
				source: [
					"src/routes/-components/app-shell.tsx",
					"src/routes/-components/home-nav.tsx",
					"src/routes/-components/page-header.tsx",
					"src/routes/-components/home-screen.tsx",
				],
				title: "首页",
				tokenGroups: ["layout"],
			},
			{
				slug: "workspace",
				source: [
					"src/routes/s/$turnId/-components/workspace-layout.tsx",
					"src/routes/s/$turnId/-components/workbench-nav.tsx",
					"src/routes/s/$turnId/-components/query-header.tsx",
				],
				title: "搜索工作台",
				tokenGroups: ["layout"],
			},
			{
				slug: "detail",
				source: ["src/routes/s/$turnId/-components/person.tsx"],
				title: "人的详情",
				tokenGroups: ["layout"],
			},
			{
				slug: "admin",
				source: [
					"src/routes/-components/admin-page.tsx",
					"src/routes/tasks/-components/task-board.tsx",
				],
				title: "管理页",
				tokenGroups: ["layout"],
			},
		],
		title: "页面布局",
	},
	{
		content: "changes",
		description:
			"查看当前的修改、保存的方案、导出的 CSS、修改波及的范围，以及写回源码。",
		icon: History,
		id: "changes",
		pages: [
			{ slug: "review", title: "修改记录" },
			{ slug: "saved", title: "保存方案" },
			{ slug: "export", title: "CSS 导出" },
			{ slug: "impact", title: "影响范围" },
			{ slug: "apply", title: "应用到源码" },
		],
		title: "修改管理",
	},
] as const satisfies readonly ModuleShape[];

type Module = (typeof CATALOG)[number];

/** 一个模块里各页的身份：`模块/页`。 */
type PageIdsOf<M extends Module> = M extends {
	id: infer ModuleId extends string;
	pages: readonly (infer Page)[];
}
	? Page extends { slug: infer Slug extends string }
		? `${ModuleId}/${Slug}`
		: never
	: never;

export type PageId = PageIdsOf<Module>;
/** 画在预览页里的页。 */
export type PreviewPageId = PageIdsOf<Exclude<Module, { content: "changes" }>>;
/** 外壳自己画的修改管理页。 */
export type ChangesPageId = PageIdsOf<Extract<Module, { content: "changes" }>>;

export interface CatalogModule extends Omit<ModuleShape, "pages"> {
	pages: readonly CatalogPage[];
}

export interface CatalogPage extends PageShape {
	id: PageId;
	module: CatalogModule;
}

export const catalog: readonly CatalogModule[] = CATALOG.map(
	(shape: ModuleShape) => {
		const module: CatalogModule = { ...shape, pages: [] };
		module.pages = shape.pages.map((page) => ({
			...page,
			id: `${shape.id}/${page.slug}` as PageId,
			module,
		}));
		return module;
	},
);

const PAGES = new Map(
	catalog.flatMap((module) => module.pages.map((page) => [page.id, page])),
);

export const pageById = (id: string): CatalogPage | undefined =>
	PAGES.get(id as PageId);

/** 目录里一定有的一页；没有说明目录与调用处不一致。 */
export function requirePage(id: string): CatalogPage {
	const page = pageById(id);
	if (!page) throw new Error(`目录里没有 ${id}`);
	return page;
}

/** 预览页画的全部页；外壳发来的页只认这些。 */
const PREVIEW_PAGE_IDS = catalog.flatMap((module) =>
	module.content === "changes" ? [] : module.pages.map((page) => page.id),
) as PreviewPageId[];

export const isPreviewPageId = (value: unknown): value is PreviewPageId =>
	PREVIEW_PAGE_IDS.some((id) => id === value);

/** 画在预览页里的页。 */
export const isPreviewPage = (
	page: CatalogPage,
): page is CatalogPage & { id: PreviewPageId } =>
	page.module.content !== "changes";

/** 外壳自己画的修改管理页。 */
export const isChangesPage = (
	page: CatalogPage,
): page is CatalogPage & { id: ChangesPageId } =>
	page.module.content === "changes";
