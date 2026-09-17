import {
	createFileRoute,
	notFound,
	Outlet,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { useCallback, useRef } from "react";
import {
	Dialog,
	DialogPanel,
	DialogPopup,
	DialogTitle,
} from "#/components/ui/dialog";
import { Kbd } from "#/components/ui/kbd";
import { ScrollArea } from "#/components/ui/scroll-area";
import { cn } from "#/lib/utils";
import { emptyFacets, type SearchOutcome } from "#/search/result";
import { emptySpec, type SearchSpec } from "#/search/spec";
import { loadWorkbench } from "#/server/functions";
import { DeadEnd } from "../../-components/dead-end";
import { useCommit } from "../../-lib/commit";
import { FilterRail, FilterSheet } from "./-components/filter-rail";
import { QueryDeck, type QueryDeckHandle } from "./-components/query-deck";
import { ResultList } from "./-components/result-list";
import { filterFields, textFilters } from "./-lib/filters";
import { useInterpretation } from "./-lib/interpret";
import { useKeyboardFlow } from "./-lib/keyboard-flow";
import { useIsWide } from "./-lib/media";
import { useNavPhase } from "./-lib/nav-phase";
import { usePicks } from "./-lib/picks";
import {
	allPages,
	canLoadMore,
	morePage,
	pageLimit,
	toFilters,
	type View,
	validateView,
} from "./-lib/view-params";

/**
 * 还没有结果的那一份。检索没跑（换查询的头一帧）时顶上去，于是**下面每一层拿到
 * 的都是一份完整的结果**，不必各写一次「没有就当空的」——写两次就是两份对
 * 「空」的定义。
 *
 * 它是个模块级常量而不是每次现造：`results` 在 `useKeyboardFlow` 的依赖数组里，
 * 每次渲染新建 `[]` 会让那个 effect 反复解绑重绑。
 */
const NO_OUTCOME: SearchOutcome = {
	order: "evidence",
	claims: [],
	results: [],
	facets: emptyFacets(),
	total: 0,
	empty: null,
};
const EMPTY_SPEC = emptySpec();

/** 详情面板的宽度。两处必须同值，值在 styles.css（页宽列也从它算出来）。 */
const PANEL_W = "w-detail 2xl:w-detail-wide";

/** 一直在的那几个：手不用离开键盘就能扫完一份名单。 */
const KEYS = [
	["/", "改问题"],
	["↑↓", "切换员工"],
	["Esc", "关闭详情"],
] as const;

/** 挑人时才有对象可挑，所以这一条只在那时候排进去。 */
const PICK_KEY = ["空格", "选择或取消"] as const;

/**
 * 工作台：**左筛选、右详情，中间是那条唯一的名单列**。
 *
 * 两侧都是辅助面，形状一致（吸顶、限高、自己滚、靠一条发丝线分层，不靠投影），
 * 因为它们地位一致：都不改「问的是什么」，只改看到的是哪一部分、哪一个人。
 * 它们也都**没有东西可给的时候就不存在**——筛选栏一个候选都数不出来时整栏不渲染，
 * 详情在没选人的时候宽度为 0。要靠填充物才不空的栏，就是它本来不该占位的证据。
 *
 * 这一页分三层，层级和产品里那条最要紧的界线同构：
 *
 * 1. **顶栏**（外壳，`__root.tsx`）：应用身份和跨查询的历史。它不属于这次查询。
 * 2. **查询带**（`QueryDeck`）：这一页**是什么**。吸在顶栏下沿、定高一行，整个
 *    工作区那么宽——因为下面两栏都在它之内；改它派生一条新记录。
 * 3. **三栏**：筛选、名单、详情。全都只动 URL 上的视图参数，不产生新记录。
 *
 * 把第 2 层塞进中间那一栏，它就和左右两栏成了兄弟——而它们其实是它的子级。
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
	// 记录的 id 只从这里取。loader 正是按路径上那一段查出这条记录的，
	// 再从 params 取一次就是同一个值的第二个名字。
	const { id: turnId, rawText, spec: settledSpec } = turn;
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

	// 键盘流的 `/` 和空名单上那条出路，都落到查询带那句原话的改写框上
	const deck = useRef<QueryDeckHandle>(null);
	const editQuery = useCallback(() => deck.current?.edit(), []);
	const wide = useIsWide();

	const spec = settledSpec ?? EMPTY_SPEC;
	const outcome = result ?? NO_OUTCOME;
	const { results, facets, total } = outcome;
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
		commit({ kind: "spec", spec: next }, { parentTurnId: turnId });

	// 挑人：选中的是谁、推给 CSV 的是什么，全在这一个钩子里（`-lib/picks.ts`）。
	const picks = usePicks(turnId, outcome);

	const canMore = canLoadMore(view, total);

	/**
	 * 导出时的「选上这 N 人」：够得着的人全要。
	 *
	 * 两半合在这一处说完——名单上这批当场选中，后面还没加载出来的那批一跳到底
	 * 拉回来，等它们到达时 `picks` 自己补上（`-lib/picks.ts` 的 `pickAll`）。
	 * 分开摆的话，没有一个地方说得出按一下到底会发生什么。
	 */
	const pickAll = () => {
		picks.pickAll(canMore);
		if (canMore) updateView(allPages(total));
	};

	useKeyboardFlow({
		onEditQuery: editQuery,
		onPick: picks.picking ? picks.toggle : undefined,
		results,
		empId,
		turnId,
		view,
	});

	return (
		<div className="mx-auto flex w-full max-w-app flex-1 flex-col">
			{/* 改写框里的草稿属于一条查询记录，换记录时不能带到下一句话。 */}
			<QueryDeck
				error={commitError ?? interpretError}
				interpreting={interpreting}
				key={turnId}
				onChangeSpec={reviseSpec}
				onQuery={(input) => commit(input, { parentTurnId: turnId })}
				onRetry={interpretError ? retryInterpret : undefined}
				rawText={rawText}
				ref={deck}
				spec={spec}
			/>

			{/*
			 * 三栏这一层：左筛选、右详情，中间是那条唯一的名单列。两侧都是辅助面，
			 * 都吸顶、都自己滚、都靠一条发丝线和中间分开——形状一致，是因为它们在
			 * 这一屏上的地位一致：都不改「问的是什么」，只改看到的是哪一部分、
			 * 哪一个人。
			 *
			 * 两侧吸的是**常驻那一叠**（顶栏加查询带）的下沿，不是这一层的顶上：
			 * 它们服务的是同一份名单，而名单可以滚很长。那一叠有多高只有
			 * `--chrome-height` 一个出处（styles.css）——查询带定高就是为了它。
			 */}
			<div className="flex min-h-0 flex-1">
				<FilterRail
					fields={fields}
					loading={loading}
					onChange={updateView}
					textFilters={texts}
				/>

				<div className="flex min-w-0 flex-1 flex-col">
					<main
						aria-label="搜索结果"
						/* 顶上那一档留白由这里给：查询带定高、贴着下沿画线，
						   它没有可以顺手撑开的内边距。 */
						className="mx-auto w-full max-w-page px-4 pt-4 pb-16"
						/* 外壳那条跳过导航跳到这里（`__root.tsx`）：正文从名单开始，
						   查询带在它之前。落点必须可聚焦，否则点了链接只滚动、焦点仍
						   留在链接上，下一次 Tab 又回到顶栏。 */
						id="main"
						tabIndex={-1}
					>
						{/* lg 以下没有并排一条栏的余地，同一份筛选收成一个按钮 */}
						<div className="mb-3 lg:hidden">
							<FilterSheet
								fields={fields}
								loading={loading}
								onChange={updateView}
								textFilters={texts}
							/>
						</div>

						<ResultList
							canMore={canMore}
							empId={empId}
							growing={growing}
							loading={loading}
							onChange={updateView}
							onEditQuery={editQuery}
							onAll={pickAll}
							onMore={() => updateView(morePage(view))}
							onReviseQuery={(conditions) => reviseSpec({ conditions })}
							outcome={outcome}
							picks={picks}
							spec={spec}
							strong={Boolean(view.strong)}
							strongOn={facets.strong.on}
							byDepth={view.order === "depth"}
							turnId={turnId}
						/>
					</main>

					{/*
					 * 快捷键写在页脚，不写在任何一个常驻的角落里。
					 *
					 * 它是「用熟之后才会用上」的东西：第一次来的人不会找它，
					 * 用熟的人记住了也不再看。挂在名单尽头，两种人都不被打扰。
					 */}
					{/* 触屏上这几个键一个都按不了，那时它只是几行占地方的灰字 */}
					<footer className="mx-auto hidden w-full max-w-page flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pb-8 text-muted-foreground text-xs pointer-fine:flex">
						{(picks.picking ? [...KEYS, PICK_KEY] : KEYS).map(([key, what]) => (
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
							"sticky top-(--chrome-height) h-[calc(100dvh-var(--chrome-height))] shrink-0 overflow-hidden",
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
						{/*
						 * 里面这一层固定宽：外面那层在做宽度动画，内容跟着一起被挤扁的话
						 * 每一帧都要重排一次文字。滚动归 `ScrollArea`，理由和左栏同一条
						 * （AGENTS.md「自己滚的面一律 `ScrollArea`」）。
						 */}
						<div className={cn(PANEL_W, "h-full")}>
							<ScrollArea overscrollContain>
								<Outlet />
							</ScrollArea>
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
						{/*
						 * 限高不写在这里：`DialogPopup` 自带 `max-h-full`，而它住在一个
						 * `fixed inset-0 p-4` 的视口里——高度上限已经是「视口减去那圈
						 * 边距」，再挑一个 dvh 的百分数只是又一个说不出理由的数。
						 * 宽度是布局，覆盖得起（默认 `max-w-lg` 对一份档案太窄）。
						 *
						 * 自己滚的那一层是 `DialogPanel`（也就是 `ScrollArea`），详情那个
						 * 吸顶的头贴在它上面——所以关掉 `scrollFade`，那层遮罩会把吸顶的
						 * 头一起蒙掉。`p-0` 是因为内边距由详情自己给。
						 */}
						<DialogPopup className="max-w-2xl">
							<DialogTitle className="sr-only">员工详情</DialogTitle>
							<DialogPanel className="p-0" scrollFade={false}>
								<Outlet />
							</DialogPanel>
						</DialogPopup>
					</Dialog>
				)}
			</div>
		</div>
	);
}
