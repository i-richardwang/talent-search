import { cn, Dialog } from "@cloudflare/kumo";
import { UsersThreeIcon } from "@phosphor-icons/react";
import {
	createFileRoute,
	Link,
	notFound,
	Outlet,
	useNavigate,
	useParams,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { emptyFacets, type SearchResult } from "#/search/result";
import { interpretTurn, loadWorkbench } from "#/server/functions";
import { FilterRail } from "../../-components/filter-rail";
import { QueryBar } from "../../-components/query-bar";
import { ResultHead } from "../../-components/result-head";
import {
	mainBasis,
	pendingTerms,
	ResultList,
} from "../../-components/result-list";
import { useCommit } from "../../-lib/commit";
import { activeFilters, filterFields } from "../../-lib/filters";
import { useKeyboardFlow } from "../../-lib/keyboard-flow";
import { useIsWide } from "../../-lib/media";
import {
	canLoadMore,
	morePage,
	onlyMore,
	pageLimit,
	toFilters,
	type View,
	validateView,
	viewChanged,
} from "../../-lib/view-params";

// 没有结果时也要有稳定的身份：每次渲染新建 [] / {} 会让依赖它们的
// useEffect 反复解绑重绑，左栏也跟着整树重算。
const NO_RESULTS: SearchResult[] = [];
const NO_FACETS = emptyFacets();

/** 理解失败时说什么。和提交失败分开：一个是这句话没读懂，一个是没送出去。 */
const INTERPRET_FAILED = "没能理解这句话，请重试或换一种说法。";

/**
 * 工作台外壳：顶栏 + 三栏（筛选 / 结果 / 详情）。
 *
 * 地址是 `/s/:turnId`——**turnId 指的是一条查询记录**，不是一串检索参数
 * （见 `-lib/view-params.ts` 开头那段分界）。所以刷新、后退、把链接粘给同事
 * 都落在同一条记录上，必然是同一批人；而改一个筛选只动 query string，
 * 不产生新记录。
 *
 * `/s/:id` 与 `/s/:id/p/:empId` 共用这一层，检索结果挂在这里——所以换人
 * 只换详情栏，不重跑 SQL。
 */
export const Route = createFileRoute("/s/$turnId")({
	validateSearch: validateView,
	// 每个字段都参与检索：五维决定筛选，n 决定要拉多少人，所以整份 view 就是依赖。
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
		<div className="flex h-dvh flex-col items-center justify-center gap-3 p-6">
			<p className="text-kumo-default">这条搜索记录不存在</p>
			<p className="text-kumo-subtle text-sm">
				链接可能已失效，或记录已被清理。
			</p>
			<Link className="text-kumo-link text-sm hover:underline" to="/">
				开始一次新搜索
			</Link>
		</div>
	);
}

function Workbench() {
	const { turn, result } = Route.useLoaderData();
	// `turnId` 就是 `turn.id`：loader 正是按路径上那一段查出这条记录的，
	// 再从 params 取一次就是同一个值的第二个名字。
	const { id: turnId, rawText, chips: settledChips } = turn;
	const view = Route.useSearch();
	const navigate = useNavigate();
	const router = useRouter();
	const { empId } = useParams({ strict: false });
	const { commit, error: commitError } = useCommit();

	/*
	 * 两种 pending 不是一回事，所以这里要把它们分开。
	 *
	 * 改筛选：旧结果已经不成立了，表格该塌成骨架屏。
	 * 只是再翻一页：已经看到的人必须留在原地——列表在按下按钮的一瞬间塌掉，
	 * 等于每翻一页就把人扔回页首，滚动位置和刚才看到哪儿全没了。
	 *
	 * `location` 是导航要去的地方，`resolvedLocation` 是还挂在屏幕上的那一个；
	 * pending 期间两者不同，差别正好回答「这次导航在干什么」。两边都过一遍
	 * validateView，免得拿裸的 URL 值去比（`n` 在一边是数字一边是字符串）。
	 *
	 * 换人（`/s/x/p/a` → `/s/x/p/b`）路径也变了，但结果表一行都不用重画，
	 * 所以要先看 turn 变没变——只比 pathname 会让扫表格的每一下都把表清空。
	 */
	const nav = useRouterState({
		select: (s) => ({
			loading: s.isLoading,
			next: {
				turn: turnOf(s.location.pathname),
				view: validateView(s.location.search),
			},
			prev: s.resolvedLocation && {
				turn: turnOf(s.resolvedLocation.pathname),
				view: validateView(s.resolvedLocation.search),
			},
		}),
	});
	const growing =
		nav.loading &&
		nav.prev?.turn === nav.next.turn &&
		onlyMore(nav.next.view, nav.prev?.view);
	const navigating =
		nav.loading &&
		(nav.prev?.turn !== nav.next.turn ||
			viewChanged(nav.next.view, nav.prev?.view));

	/*
	 * 还没理解完的记录：工作台已经画出来了，模型那一跳在这里就地补上。
	 *
	 * 模型那一跳最长要 60 秒，所以它不能挡在导航前面：提交只落一条记录（一次
	 * INSERT），工作台立刻出现，理解在这里补。转圈因此发生在结果将要出现的
	 * 地方，而不是发生在按钮上。
	 *
	 * 写成 effect 而不是放进 loader，就是这个意思——loader 里一 await，
	 * 工作台又得等到模型回来才画得出来。
	 *
	 * 服务端那侧只补 `chips is null` 的行，所以这里重复触发（严格模式的双次
	 * 挂载、两个标签页开着同一条记录）都拿回同一份结果，不会各理解一次。
	 */
	const [interpretFailed, setInterpretFailed] = useState(false);
	const interpreting = settledChips === null && !interpretFailed;
	useEffect(() => {
		if (settledChips !== null) return;
		let alive = true;
		interpretTurn({ data: { turnId } })
			.then(({ filters }) => {
				if (!alive) return;
				/*
				 * 模型顺带认出来的筛选（只看入职前、公司档、最短时长）在这里
				 * **一次性播进 URL**，此后 URL 就是筛选的唯一事实源。不这样做
				 * 的话，它们既在记录上又在 URL 上：用户把「只看入职前」关掉，
				 * 刷新一次又自己回来了。
				 */
				if (Object.keys(filters).length > 0)
					navigate({
						to: ".",
						search: (o) => ({ ...o, ...filters }),
						replace: true,
					});
				else router.invalidate();
			})
			.catch(() => {
				if (alive) setInterpretFailed(true);
			});
		return () => {
			alive = false;
		};
	}, [settledChips, turnId, navigate, router]);

	const inputRef = useRef<HTMLInputElement>(null);
	// xl 以上左栏常驻，这个开关只在 xl 以下有意义
	const [railOpen, setRailOpen] = useState(false);
	const wide = useIsWide();

	const chips = settledChips ?? [];
	const terms = result?.terms ?? [];
	const results = result?.results ?? NO_RESULTS;
	const facets = result?.facets ?? NO_FACETS;
	// 理解中和检索中在表格里是同一件事：下面这张表还不成立，画骨架屏。
	const loading = navigating || interpreting;

	/**
	 * 改视图。**不产生新的查询记录**——同一条查询，换个看法。
	 * 改任何筛选都回到第一页：留着翻页数会直接拉 150 人回来，
	 * 比第一次检索慢三倍，而人根本没要求看那么多。
	 */
	const updateView = (next: Partial<View>) =>
		navigate({ to: ".", search: (old) => ({ ...old, n: undefined, ...next }) });

	// 改查询：派生一条挂在当前记录上的新记录。push，所以后退键就是撤销。
	const reviseChips = (next: typeof chips) =>
		commit({ kind: "chips", chips: next }, { parentTurnId: turn.id, view });

	// 筛选维度在这里算一次：左栏要拿它渲染，中栏的窄屏把手要拿它数「筛了几项」。
	// 两处各算一遍就有了两份可能不一致的同名东西。
	const fields = filterFields(facets, view);

	/*
	 * 中栏有几列概念词。理解完成之前取自记录上还没有的 chips，所以先按
	 * 一列算——那正是「正在理解」时表头该有的样子：一列占位，不假装知道
	 * 最后会有几个词。
	 */
	const columns = pendingTerms(chips).length;

	useKeyboardFlow({ inputRef, results, empId, turnId, view });

	// 筛选开着还能换人的只剩一条路：浏览器前进后退换掉了 URL。对话框是模态的，
	// 背景既点不到也 Tab 不进，正常操作走不到这里。真走到了就把筛选收起来，
	// 两个对话框叠着没有意义。
	useEffect(() => {
		if (empId) setRailOpen(false);
	}, [empId]);

	// 同一份左栏，两种容器：宽屏是常驻栏，窄屏是对话框。内容一份，布局各给各的。
	const railProps = {
		fields,
		hasQuery: terms.length > 0,
		onChange: updateView,
		view,
		strongCount: facets.strong.on,
	};

	return (
		/*
		 * `isolate` 是这一层最重要的一个类。
		 *
		 * Kumo 的 Popover / Tooltip / Select / Dialog 内容 portal 到 document.body，而且
		 * **自身不带 z-index**。CSS 的绘制顺序里「z-index: auto 的定位元素」排在
		 * 「z-index > 0 的定位元素」之前，所以只要外壳里有任何一个正数 z，
		 * 它就会盖住所有弹层。
		 *
		 * 在这里开一个层叠上下文，把外壳内部那三档 z 全部关进去。关进去之后，
		 * body 下的 portal 永远画在整个外壳之上，无论内部用到多大的 z——
		 * 这类遮挡从结构上不可能发生，不必给每个弹层补一个更大的数字。
		 */
		<div className="isolate flex h-dvh flex-col">
			{/* 必须是文档里第一个可聚焦元素，否则「跳过」的东西已经先被 Tab 过一遍了 */}
			<a
				className="sr-only rounded-sheet bg-kumo-base px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-escape"
				href="#results"
			>
				跳到搜索结果
			</a>

			{/*
			 * 顶栏只剩身份和查询。控件属于左栏，图例属于详情栏，这里不放。
			 *
			 * 顶栏没有底色也没有下边框：它坐在画布上，不是一条独立的条。
			 * 「这里到哪儿为止」由下面那块面板的上边缘回答，画两遍就成了两条线。
			 *
			 * 顶栏的左边不留内边距，品牌块自己占住左栏那么宽（224 / 240）再加
			 * 12px 的间隙——于是查询框的左边缘正好落在下面那块面板的左边缘上，
			 * 而品牌文字的左边缘落在全局那条 16px 竖线上。品牌块不能是自然宽：
			 * 那样查询框的起点跟着产品名的字数走，不跟任何东西对齐。
			 */}
			<header className="flex h-14 shrink-0 items-center gap-3 pr-3">
				<Link
					className="flex shrink-0 items-center gap-2 px-4 text-kumo-default no-underline xl:w-56 2xl:w-60"
					to="/"
				>
					{/*
					 * 全站唯一一处品牌色。它和「橙 = 受控字段命中」那套编码不冲突：
					 * 编码活在面板**里面**（点、色块、时间轴），这里是画布上的
					 * 身份标记，两者永远不并排出现。
					 */}
					<UsersThreeIcon
						className="text-kumo-brand"
						size={20}
						weight="duotone"
					/>
					{/* 这一页的 h1。视觉不变，但大纲得从这里起头——
					    详情栏的姓名是这一页里的一节，不是整页的标题。 */}
					<h1 className="font-semibold text-lg">人才搜索</h1>
				</Link>
				<QueryBar
					// 顶栏这个框是「加条件」：整句同样要过理解，所以它也派生一条
					// 挂在当前记录上的新记录，新词接在已有条件后面（见 interpretTurn）。
					inputRef={inputRef}
					onQuery={(input) => commit(input, { parentTurnId: turn.id, view })}
					variant="header"
				/>
			</header>

			{/*
			 * 工作台的骨架：左栏留在画布上，中栏和详情栏一起装进一块**浮起来的
			 * 面板**（圆角 + 发丝边框 + base 底色，四周留 8px 让画布透出来）。
			 *
			 * 这是整个界面「像产品」还是「像后台」的分界。铺满窗口、只靠发丝线
			 * 切开的平面是终端和管理后台的长相；内容住在一块有边界的面板里、
			 * 面板浮在略深的画布上，才是这一类工作台的通用结构。
			 *
			 * 左栏不进面板，也不需要自己的底色和右边框：它就在画布上，
			 * 面板的左边缘就是它们之间的界线。少一条线，少一层底色。
			 *
			 * 左边不留内边距——左栏自己的 16px 内边距就是全局那条竖线，
			 * 和顶栏对齐。窄屏左栏收进对话框，那时才补 `pl-3` 把面板摆正。
			 */}
			<div className="flex min-h-0 flex-1 gap-3 pr-3 pb-3 max-xl:pl-3">
				{wide ? (
					// 常驻左栏。14 → 15rem，上限就是最长的那个序列标签，再宽是空的。
					// `max-xl:hidden` 是首帧护栏：窄屏第一帧按宽屏渲染（见 -lib/media.ts），
					// 靠它挡住，挂载后就走下面那一支了。
					<FilterRail
						className="max-xl:hidden w-56 shrink-0 2xl:w-60"
						{...railProps}
					/>
				) : (
					<Dialog.Root onOpenChange={setRailOpen} open={railOpen}>
						{/* 限高，滚动交给左栏自己的 overflow-y-auto */}
						<Dialog className="max-h-[85dvh]">
							{/*
							 * 对话框的可及名称只能来自 Dialog.Title——Kumo 的 Dialog
							 * 不透传 aria-label。左栏自己那个「筛选」标题是内容的一
							 * 部分，这一句是容器的名字，两者角色不同。
							 */}
							<Dialog.Title className="sr-only">筛选</Dialog.Title>
							{/* 对话框自带 base 底色，左栏在这里不另铺一层 */}
							<FilterRail {...railProps} />
						</Dialog>
					</Dialog.Root>
				)}

				{/*
				 * 内容面板：中栏和详情栏共用一个边界。它们是同一件事的两半
				 * （看哪些人 / 看这一个人），中间一条发丝线就够，不该是两块
				 * 各自浮着的板子——那会让详情栏读起来像另一个应用的窗口。
				 * `overflow-hidden` 是圆角能成立的前提。
				 */}
				<div className="flex min-w-0 flex-1 overflow-hidden rounded-panel border border-kumo-hairline bg-kumo-base">
					<main
						aria-label="搜索结果"
						/*
						 * `grow-0` + basis：宽度不够时照常收缩（xl 上 614px，表格
						 * 自己横滚），有富余时不再长。富余归详情栏——留在这里就是
						 * 表格右边那片对不齐的空白，连滚动条都画在它的最外侧。
						 *
						 * xl 以下详情栏是隐藏的，富余没有第二个接收方，所以 `mx-auto`
						 * 把它分到两边：中栏在面板里居中成一列。
						 */
						className={cn(
							"flex min-w-0 flex-col",
							columns > 0 ? "shrink grow-0 max-xl:mx-auto" : "flex-1",
						)}
						id="results"
						style={columns > 0 ? { flexBasis: mainBasis(columns) } : undefined}
						/* 跳过导航的落点必须可聚焦，否则点了链接只滚动、
						   焦点仍在链接上，下一次 Tab 又回到顶栏 */
						tabIndex={-1}
					>
						<ResultHead
							activeFilters={activeFilters(fields).length}
							chips={chips}
							degraded={turn.degraded}
							error={commitError ?? (interpretFailed ? INTERPRET_FAILED : null)}
							interpreting={interpreting}
							loading={loading}
							onChangeQuery={reviseChips}
							onOpenFilters={() => setRailOpen(true)}
							onReinterpret={
								rawText
									? () => commit({ kind: "sentence", text: rawText })
									: undefined
							}
							rawText={rawText}
							terms={terms}
							total={result?.total ?? 0}
						/>
						{/* 表格默认吃满中栏——批量筛人时横向对比才是主任务 */}
						<div className="min-h-0 flex-1 overflow-auto">
							<ResultList
								canMore={canLoadMore(view, result?.total ?? 0)}
								chips={chips}
								empId={empId}
								growing={growing}
								loading={loading}
								onChange={updateView}
								onFocusQuery={() => inputRef.current?.focus()}
								onMore={() => updateView(morePage(view))}
								onReviseQuery={reviseChips}
								results={results}
								terms={terms}
								tooWide={result?.tooWide ?? false}
								total={result?.total ?? 0}
								turnId={turnId}
								view={view}
								withoutStrong={facets.strong.off}
							/>
						</div>
					</main>

					{wide ? (
						/*
						 * 宽屏的第三栏是常驻的、**非模态**的：开着也能继续用 ↑↓ 扫表格，
						 * 内容跟着换。这一点不能丢，所以宽屏不用 Dialog。
						 *
						 * 三栏在 xl（1280）才展开，不是 lg。1024 上摆不下：左栏 224 +
						 * 详情栏 416 再扣掉面板的边距与边框之后中栏只剩 366，
						 * 而表格的 min-width 是 600。
						 *
						 * 26 → 34rem 之后就停。中文阅读的舒适行长是 30-40 字。
						 */
						<aside
							aria-label="员工详情"
							className={cn(
								"max-xl:hidden overflow-y-auto overscroll-contain",
								"shrink-0 basis-[26rem]",
								columns > 0 && "grow",
								// 在面板内部，底色由面板给；只留那条把两半分开的线
								"border-kumo-hairline border-l",
							)}
						>
							<Outlet />
						</aside>
					) : (
						/*
						 * 窄屏没有第三栏的余地，它盖住整个工作台——那就该是个真模态：
						 * 焦点关在里面、背景不可 Tab、Esc 收起、关掉还焦。这些由 Dialog
						 * 提供，不自己搭。关掉等于回到列表，所以是一次 replace 导航。
						 */
						<Dialog.Root
							onOpenChange={(open) => {
								if (!open)
									navigate({
										to: "/s/$turnId",
										params: { turnId },
										search: view,
										replace: true,
									});
							}}
							open={Boolean(empId)}
						>
							{/* 限高并自己滚：详情栏那个吸顶的头就贴在这个滚动容器上 */}
							<Dialog className="max-h-[85dvh] overflow-y-auto" size="xl">
								<Dialog.Title className="sr-only">员工详情</Dialog.Title>
								<Outlet />
							</Dialog>
						</Dialog.Root>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * 从路径里取这次导航落在哪条查询记录上。
 *
 * pending 期间拿不到 `params`（那是导航完成之后的事），只有一个 pathname，
 * 所以这里手工取第二段。`/s/:turnId` 与 `/s/:turnId/p/:empId` 都落在同一段上，
 * 于是「换人」不会被当成「换查询」。
 */
function turnOf(pathname: string) {
	return pathname.split("/")[2];
}
