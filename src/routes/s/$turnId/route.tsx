import {
	createFileRoute,
	notFound,
	Outlet,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { useCallback, useRef } from "react";
import { buttonVariants } from "#/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "#/components/ui/dialog";
import { Kbd } from "#/components/ui/kbd";
import { cn } from "#/lib/utils";
import { emptyFacets, type SearchResult } from "#/search/result";
import { emptySpec, type SearchSpec } from "#/search/spec";
import { loadWorkbench } from "#/server/functions";
import { DeadEnd } from "../../-components/dead-end";
import { FilterRail, FilterSheet } from "../../-components/filter-rail";
import { QueryDeck, type QueryDeckHandle } from "../../-components/query-deck";
import { ResultList } from "../../-components/result-list";
import { useCommit } from "../../-lib/commit";
import { filterFields, textFilters } from "../../-lib/filters";
import { useInterpretation } from "../../-lib/interpret";
import { useKeyboardFlow } from "../../-lib/keyboard-flow";
import { useIsWide } from "../../-lib/media";
import { useNavPhase } from "../../-lib/nav-phase";
import {
	canLoadMore,
	morePage,
	pageLimit,
	toFilters,
	type View,
	validateView,
} from "../../-lib/view-params";

/**
 * 没有结果时也要有稳定的身份：`results` 在 `useKeyboardFlow` 的依赖数组里
 * （见 -lib/keyboard-flow.ts），每次渲染新建 `[]` 会让那个 effect 反复解绑重绑。
 */
const NO_RESULTS: SearchResult[] = [];
const EMPTY_SPEC = emptySpec();

/** 详情面板的宽度。两处必须同值，值在 styles.css（页宽列也从它算出来）。 */
const PANEL_W = "w-detail 2xl:w-detail-wide";

/** 手不用离开键盘就能扫完一份名单，这三个键是全部。 */
const KEYS = [
	["/", "改问题"],
	["↑↓", "切换员工"],
	["Esc", "关闭详情"],
] as const;

/**
 * 工作台：**一列名单，加一块从右侧推进来的详情**。
 *
 * 不做并排的竖栏。三条栏全屏铺满、靠发丝线切开是管理后台的形状，而换一套
 * 组件库改不掉形状。这里只有一列：页面像一份文档一样整页滚动，查询台吸在
 * 顶上，详情**在选中一个人的时候才存在**。
 *
 * 最后那一条是硬要求。一块常驻的栏空着的时候必须找东西去填，而要靠填充物
 * 才不空的栏，就是它本来不该常驻的证据。
 *
 * 地址是 `/s/:turnId`——**turnId 指的是一条查询记录**，不是一串检索参数
 * （见 `-lib/view-params.ts` 开头那段分界）。所以刷新、后退、把链接粘给同事
 * 都落在同一条记录上，问的必然是同一个问题；而改一个筛选只动 query string，
 * 不产生新记录。
 *
 * `/s/:id` 与 `/s/:id/p/:empId` 共用这一层，检索结果挂在这里——所以换人
 * 只换详情，不重跑 SQL。
 */
export const Route = createFileRoute("/s/$turnId")({
	validateSearch: validateView,
	// 每个字段都参与检索：范围字段决定筛选，n 决定要拉多少人，所以整份 view 就是依赖。
	// 查询本身不在依赖里——它由路径上的 turnId 决定。
	loaderDeps: ({ search }) => search,
	loader: async ({ params, deps }) => {
		const data = await loadWorkbench({
			data: {
				turnId: params.turnId,
				filters: toFilters(deps),
				limit: pageLimit(deps),
			},
		});
		if (!data) throw notFound();
		return data;
	},
	component: Workbench,
	notFoundComponent: TurnNotFound,
});

function TurnNotFound() {
	return (
		<DeadEnd
			description="链接可能已失效，或记录已被清理。"
			title="这条搜索记录不存在"
		/>
	);
}

function Workbench() {
	const { turn, result } = Route.useLoaderData();
	// `turnId` 就是 `turn.id`：loader 正是按路径上那一段查出这条记录的，
	// 再从 params 取一次就是同一个值的第二个名字。
	const { id: turnId, rawText, spec: settledSpec, canReinterpret } = turn;
	const view = Route.useSearch();
	const navigate = useNavigate();
	const { empId } = useParams({ strict: false });
	const { commit, error: commitError } = useCommit();

	const { growing, navigating } = useNavPhase();
	const {
		interpreting,
		error: interpretError,
		retry: retryInterpret,
	} = useInterpretation(turnId, settledSpec);

	// 键盘流的 `/` 和空名单上那条出路，都落到查询台的改写框上
	const deck = useRef<QueryDeckHandle>(null);
	const editQuery = useCallback(() => deck.current?.edit(), []);
	const wide = useIsWide();

	const spec = settledSpec ?? EMPTY_SPEC;
	const results = result?.results ?? NO_RESULTS;
	const facets = result?.facets ?? emptyFacets();
	// 同一份筛选，宽屏摊成一条栏、窄屏收成一个按钮，两处画的是同一组值
	const fields = filterFields(facets, view);
	const texts = textFilters(view);
	// 理解中和检索中在列表里是同一件事：下面这份名单还不成立，画骨架屏。
	const loading = navigating || interpreting;
	const open = Boolean(empId);

	/**
	 * 改视图。**不产生新的查询记录**——同一条查询，换个看法。
	 * 改任何筛选都回到第一页：留着翻页数会直接拉 150 人回来，
	 * 比第一次检索慢三倍，而人根本没要求看那么多。
	 */
	const updateView = (next: Partial<View>) =>
		navigate({ to: ".", search: (old) => ({ ...old, n: undefined, ...next }) });

	// 改查询：派生一条挂在当前记录上的新记录。push，所以后退键就是撤销。
	const reviseSpec = (next: SearchSpec) =>
		commit({ kind: "spec", spec: next }, { parentTurnId: turn.id });

	useKeyboardFlow({ onEditQuery: editQuery, results, empId, turnId, view });

	return (
		<div className="mx-auto flex w-full max-w-app flex-1">
			{/* 必须是文档里第一个可聚焦元素，否则「跳过」的东西已经先被 Tab 过一遍了 */}
			<a
				className={buttonVariants({
					className:
						"sr-only no-underline focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-escape",
					size: "sm",
					variant: "outline",
				})}
				href="#results"
			>
				跳到搜索结果
			</a>

			{/*
			 * 左筛选、右详情，中间是那条唯一的名单列。两侧都是辅助面，都吸顶、
			 * 都自己滚、都靠一条发丝线和中间分开——形状一致，是因为它们在这一屏上
			 * 的地位一致：都不改「问的是什么」，只改看到的是哪一部分、哪一个人。
			 */}
			<FilterRail fields={fields} onChange={updateView} textFilters={texts} />

			<div className="flex min-w-0 flex-1 flex-col">
				{/* 改写框里的草稿属于一条查询记录，换记录时不能带到下一句话。 */}
				<QueryDeck
					error={commitError ?? interpretError}
					interpreting={interpreting}
					key={turn.id}
					onChangeSpec={reviseSpec}
					onQuery={(input) => commit(input, { parentTurnId: turn.id })}
					onReinterpret={
						canReinterpret
							? () => commit({ kind: "reinterpret" }, { parentTurnId: turn.id })
							: undefined
					}
					onRetry={interpretError ? retryInterpret : undefined}
					rawText={rawText}
					ref={deck}
					spec={spec}
				/>

				<main
					aria-label="搜索结果"
					className="mx-auto w-full max-w-page px-4 pt-4 pb-16"
					id="results"
					/* 跳过导航的落点必须可聚焦，否则点了链接只滚动、
					   焦点仍在链接上，下一次 Tab 又回到顶栏 */
					tabIndex={-1}
				>
					{/* lg 以下没有并排一条栏的余地，同一份筛选收成一个按钮 */}
					<div className="mb-3 lg:hidden">
						<FilterSheet
							fields={fields}
							onChange={updateView}
							textFilters={texts}
						/>
					</div>

					<ResultList
						canMore={canLoadMore(view, result?.total ?? 0)}
						empId={empId}
						growing={growing}
						loading={loading}
						onChange={updateView}
						onEditQuery={editQuery}
						onMore={() => updateView(morePage(view))}
						onReviseQuery={(evidence) => reviseSpec({ ...spec, evidence })}
						outcome={result}
						spec={spec}
						strongOn={facets.strong.on}
						turnId={turnId}
						view={view}
						withoutStrong={facets.strong.off}
					/>
				</main>

				{/*
				 * 快捷键写在页脚，不写在任何一个常驻的角落里。
				 *
				 * 它是「用熟之后才会用上」的东西：第一次来的人不会找它，
				 * 用熟的人记住了也不再看。挂在名单尽头，两种人都不被打扰。
				 */}
				{/* 触屏上这三个键一个都按不了，那时它只是三行占地方的灰字 */}
				<footer className="mx-auto hidden w-full max-w-page flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pb-8 text-muted-foreground text-xs pointer-fine:flex">
					{KEYS.map(([key, what]) => (
						<span className="flex items-center gap-1.5" key={key}>
							<Kbd>{key}</Kbd>
							{what}
						</span>
					))}
				</footer>
			</div>

			{wide ? (
				/*
				 * 宽屏：详情**把名单推开**，不盖在上面——扫名单和核对证据是同一个判断的
				 * 两半，遮住一半就得反复开合。所以它是一个真正占位的兄弟节点。
				 *
				 * 宽度做 transition 而不是位移：占位变了，中间那一列才会自己重新居中。
				 * 分层靠左边那条边，不靠投影。关着的时候宽度是 0——它在没选人的时候
				 * 根本不存在，所以不必去想「空着的时候摆点什么」。
				 */
				<aside
					aria-label="员工详情"
					className={cn(
						"sticky top-(--header-height) h-[calc(100dvh-var(--header-height))] shrink-0 overflow-hidden",
						"transition-[width] duration-200 ease-out",
						/*
						 * 服务端一律按宽屏渲染（`useIsWide`），而**首屏可以直接落在
						 * 某个人身上**——`/s/:id/p/:empId` 正是粘给同事的那种链接。
						 * 手机上那一帧会是一块 28rem 的栏顶在 390px 的屏幕旁边，
						 * 横着溢出，水合之后才换成 Dialog。这条 CSS 让那一帧收起来：
						 * 断点和 `useIsWide` 同值，两边说的是同一件事。
						 */
						"max-xl:hidden",
						open ? `${PANEL_W} border-border border-l bg-card` : "w-0",
					)}
				>
					<div
						className={cn(PANEL_W, "h-full overflow-y-auto overscroll-contain")}
					>
						<Outlet />
					</div>
				</aside>
			) : (
				/*
				 * 窄屏没有推开的余地，它盖住整块——那就该是个真模态：焦点关在里面、
				 * 背景不可 Tab、Esc 收起、关掉还焦。这些由 Dialog 提供，不自己搭。
				 * 关掉等于回到名单，所以是一次 replace 导航。
				 */
				<Dialog
					onOpenChange={(o) => {
						if (!o)
							navigate({
								to: "/s/$turnId",
								params: { turnId },
								search: view,
								replace: true,
							});
					}}
					open={open}
				>
					{/* 限高并自己滚：详情那个吸顶的头就贴在这个滚动容器上 */}
					<DialogPopup className="max-h-[85dvh] max-w-2xl overflow-y-auto p-0">
						<DialogTitle className="sr-only">员工详情</DialogTitle>
						<Outlet />
					</DialogPopup>
				</Dialog>
			)}
		</div>
	);
}
