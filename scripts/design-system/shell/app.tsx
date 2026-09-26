import {
	ChevronRight,
	Moon,
	PanelLeftClose,
	PanelLeftOpen,
	PanelRightOpen,
	Sun,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Drawer } from "#/components/ui/drawer";
import { Segmented } from "#/components/ui/segmented";
import { cn } from "#/lib/utils";
import { isChangesPage, isPreviewPage } from "../shared/catalog";
import { INITIAL_PREVIEW } from "../shared/protocol";
import { href, type Route, resolveRoute, routeTitle } from "../shared/routes";
import { updateToken } from "../shared/source";
import {
	changeCount,
	type Draft,
	type TokenPreview,
} from "../shared/tokens/draft";
import { type SizeTier, THEMES, type Theme } from "../shared/tokens/registry";
import { ChangesPage } from "./changes";
import { ExportDialog, SaveSchemeDialog } from "./dialogs";
import { INSPECTOR_ID, Inspector } from "./inspector";
import { NARROW_MAIN_MIN_HEIGHT, NAV_WIDTH, SHELL_MIN_HEIGHT } from "./layout";
import { NAV_DRAWER_ID, Navigation } from "./navigation";
import { Notices, useNotice } from "./notices";
import { ModuleIndex, NotFound, Overview } from "./pages/overview";
import { PreviewArea, type PreviewView } from "./preview-area";
import { useSetting } from "./storage";
import { TopBar } from "./top-bar";
import { useDraftSession } from "./use-draft-session";

/*
 * 设计系统的外壳：顶栏；左栏是目录；中间是页头与当前页；打开画在预览里的页时右边有设计参数。
 * 左右两栏都能收起，收起后展开的按钮挪到页头上；窄于 lg 时左栏收进抽屉，从顶栏打开。
 *
 * 修改版只在预览里生效：预览页收到修改版后把它压在源样式上面。「查看原版」看源文件
 * 里的样子，「并排对比」把原版和修改版并排。
 */

const PANEL = ["open", "closed"] as const;
const NAVIGATION_ID = "design-system-navigation";

const subscribeHash = (notify: () => void) => {
	window.addEventListener("hashchange", notify);
	return () => window.removeEventListener("hashchange", notify);
};

const useHash = () => useSyncExternalStore(subscribeHash, () => location.hash);

export function App() {
	const hash = useHash();
	const route = resolveRoute(hash);
	const session = useDraftSession();
	const { draft } = session;
	const [notice, setNotice] = useNotice();
	const [theme, setTheme] = useSetting<Theme>(
		"theme",
		THEMES,
		INITIAL_PREVIEW.theme,
	);
	const [nav, setNav] = useSetting("nav", PANEL, "open");
	const [inspector, setInspector] = useSetting("inspector", PANEL, "open");
	const [navDrawer, setNavDrawer] = useState(false);
	const [view, setView] = useState<PreviewView>("edited");
	const [sizeTier, setSizeTier] = useState<SizeTier>(INITIAL_PREVIEW.sizeTier);
	const [selectedColor, setSelectedColor] = useState<string>(
		INITIAL_PREVIEW.selectedColor,
	);
	const [preview, setPreview] = useState<TokenPreview | null>(null);
	const [saveOpen, setSaveOpen] = useState(false);
	const [exportOpen, setExportOpen] = useState(false);

	// 换页时，只属于上一页的状态回到初始：看修改版、尺寸档回到初值、没有拖动中的值；
	// 从导出对话框里的链接换页时对话框关上。
	const [shownHash, setShownHash] = useState(hash);
	if (hash !== shownHash) {
		setShownHash(hash);
		setView("edited");
		setSizeTier(INITIAL_PREVIEW.sizeTier);
		setPreview(null);
		setExportOpen(false);
	}

	const page = route.kind === "page" ? route.page : undefined;
	const title = routeTitle(route);
	const count = changeCount(draft);
	const previewDraft = preview
		? updateToken(draft, preview.scope, preview.key, preview.value)
		: draft;

	useEffect(() => {
		document.title =
			route.kind === "overview"
				? title
				: `${title} · ${routeTitle({ kind: "overview" })}`;
	}, [route.kind, title]);

	const edit = (next: Draft) => {
		setPreview(null);
		session.edit(next);
		setView((current) => (current === "original" ? "edited" : current));
	};

	// 收起或展开一栏后，切换按钮换了位置；焦点交给新出现的那个按钮，键盘用户不会丢位置。
	const leftToggleRef = useRef<HTMLButtonElement>(null);
	const rightExpandRef = useRef<HTMLButtonElement>(null);
	const rightCollapseRef = useRef<HTMLButtonElement>(null);
	const focusNextFrame = (ref: { current: HTMLButtonElement | null }) =>
		requestAnimationFrame(() => ref.current?.focus());
	const leftToggle = (
		<ActionIcon
			aria-controls={NAVIGATION_ID}
			aria-expanded={nav === "open"}
			className="max-lg:hidden"
			icon={nav === "open" ? PanelLeftClose : PanelLeftOpen}
			onClick={() => {
				setNav(nav === "open" ? "closed" : "open");
				focusNextFrame(leftToggleRef);
			}}
			ref={leftToggleRef}
			size="small"
			title={nav === "open" ? "收起左侧栏" : "展开左侧栏"}
		/>
	);
	const previewPage = page && isPreviewPage(page) ? page : undefined;

	return (
		<div
			className={cn(
				"flex h-dvh flex-col bg-layout text-base text-fg max-sm:h-auto max-sm:min-h-dvh",
				SHELL_MIN_HEIGHT,
			)}
		>
			<TopBar
				canRedo={session.canRedo}
				canUndo={session.canUndo}
				navDrawerOpen={navDrawer}
				onExport={() => setExportOpen(true)}
				onOpenNav={() => setNavDrawer(true)}
				onRedo={session.redo}
				onSave={() => setSaveOpen(true)}
				onUndo={session.undo}
			/>
			<div className="flex min-h-0 flex-1 max-sm:flex-col">
				{nav === "open" && (
					<aside
						className="flex shrink-0 flex-col overflow-y-auto border-border-secondary border-r bg-container px-3 pb-4 max-lg:hidden"
						id={NAVIGATION_ID}
						style={{ width: NAV_WIDTH }}
					>
						<div className="sticky top-0 z-raise flex min-h-12 shrink-0 items-center justify-between bg-container pl-2.5 text-fg-tertiary text-xs">
							设计系统
							{leftToggle}
						</div>
						<Navigation route={route} />
					</aside>
				)}
				<Drawer
					noHeader
					onClose={() => setNavDrawer(false)}
					open={navDrawer}
					placement="left"
					width={NAV_WIDTH}
				>
					<div id={NAV_DRAWER_ID}>
						<Navigation onNavigate={() => setNavDrawer(false)} route={route} />
					</div>
				</Drawer>
				<main
					className={cn(
						"flex min-w-0 flex-1 flex-col max-sm:flex-none",
						NARROW_MAIN_MIN_HEIGHT,
					)}
				>
					<div className="flex items-center justify-between gap-4 px-7 pt-6 pb-5 max-xl:px-5 max-xl:py-5">
						<div className="flex min-w-0 items-center gap-2">
							{nav === "closed" && leftToggle}
							<div className="min-w-0">
								{route.kind !== "overview" && <Breadcrumb route={route} />}
								<h1 className="font-semibold text-xl tracking-tight">
									{title}
								</h1>
							</div>
						</div>
						{previewPage && (
							<div className="flex shrink-0 items-center gap-2">
								<Segmented<Theme>
									aria-label="预览主题"
									onChange={(next) => {
										setPreview(null);
										setTheme(next);
									}}
									options={[
										{
											icon: <Sun className="size-4" />,
											title: "浅色",
											value: "light",
										},
										{
											icon: <Moon className="size-4" />,
											title: "深色",
											value: "dark",
										},
									]}
									value={theme}
								/>
								{inspector === "closed" && (
									<ActionIcon
										aria-controls={INSPECTOR_ID}
										aria-expanded={false}
										icon={PanelRightOpen}
										onClick={() => {
											setInspector("open");
											focusNextFrame(rightCollapseRef);
										}}
										ref={rightExpandRef}
										size="small"
										title="展开右侧栏"
									/>
								)}
							</div>
						)}
					</div>
					{previewPage ? (
						<PreviewArea
							changes={count}
							onSelectColor={setSelectedColor}
							onView={setView}
							page={previewPage}
							state={{ draft: previewDraft, selectedColor, sizeTier, theme }}
							view={view}
						/>
					) : (
						<div className="min-h-0 flex-1 overflow-auto px-7 pb-8 max-xl:px-5">
							{route.kind === "overview" && <Overview />}
							{route.kind === "module" && <ModuleIndex module={route.module} />}
							{route.kind === "notFound" && <NotFound />}
							{page && isChangesPage(page) && (
								<ChangesPage
									id={page.id}
									onEdit={edit}
									onExport={() => setExportOpen(true)}
									onNotice={setNotice}
									onSave={() => setSaveOpen(true)}
									session={session}
								/>
							)}
						</div>
					)}
				</main>
				{previewPage && inspector === "open" && (
					<Inspector
						collapseRef={rightCollapseRef}
						editing={{
							draft,
							onEdit: edit,
							onPreview: setPreview,
							previewDraft,
						}}
						onCollapse={() => {
							setPreview(null);
							setInspector("closed");
							focusNextFrame(rightExpandRef);
						}}
						onExport={() => setExportOpen(true)}
						onSelectColor={setSelectedColor}
						onSizeTier={setSizeTier}
						page={previewPage}
						selectedColor={selectedColor}
						sizeTier={sizeTier}
						theme={theme}
					/>
				)}
			</div>
			<SaveSchemeDialog
				count={count}
				onClose={() => setSaveOpen(false)}
				onSave={(name) => {
					session.saveScheme(name);
					setSaveOpen(false);
					setNotice("方案已保存到这台浏览器");
				}}
				open={saveOpen}
			/>
			<ExportDialog
				draft={draft}
				onClose={() => setExportOpen(false)}
				onNotice={setNotice}
				open={exportOpen}
			/>
			<Notices
				notice={notice}
				onDismiss={() => setNotice(null)}
				storageFailed={session.storageFailed}
			/>
		</div>
	);
}

function Breadcrumb({ route }: { route: Route }) {
	return (
		<div className="mb-3 flex flex-wrap items-center gap-2 text-fg-tertiary text-xs">
			<a className="text-fg-tertiary hover:text-fg" href={href.overview}>
				总览
			</a>
			{route.kind === "page" && (
				<>
					<ChevronRight className="size-3" />
					<a
						className="text-fg-tertiary hover:text-fg"
						href={href.module(route.page.module)}
					>
						{route.page.module.title}
					</a>
				</>
			)}
		</div>
	);
}
