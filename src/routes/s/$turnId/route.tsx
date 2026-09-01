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
import { Dialog, DialogPopup, DialogTitle } from "#/components/ui/dialog";
import { Kbd } from "#/components/ui/kbd";
import { cn } from "#/lib/utils";
import { emptyFacets, type SearchResult } from "#/search/result";
import { interpretTurn, loadWorkbench } from "#/server/functions";
import { Brand } from "../../-components/brand";
import { StrengthLegend } from "../../-components/evidence";
import { QueryDeck } from "../../-components/query-deck";
import { ResultList } from "../../-components/result-list";
import { useCommit } from "../../-lib/commit";
import { filterFields } from "../../-lib/filters";
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
// useEffect 反复解绑重绑。
const NO_RESULTS: SearchResult[] = [];
const NO_FACETS = emptyFacets();

/**
 * 详情面板的宽度。外层负责收展（0 ↔ 这个值），内层写死它顶住内容，
 * 于是收展过程中里面的东西不会跟着被压扁再弹开。两处必须是同一个值，
 * 所以只有一个值——写两遍的话，某一次只改了一处，表现是面板展开到一半
 * 时内容先横移一下再归位，而那种抖动没有任何检查会报。
 *
 * 28rem 起步：xl（1280）上给名单留下 800，版心 736 还剩两边各 32 的余量。
 * 2xl 上放宽到 32rem——简历原文是这块面板里唯一成段读的东西，宽一点就少
 * 几次换行；再宽没有意义，`read-cjk` 已经把行长封在 34rem 了。
 */
const PANEL_W = "w-[28rem] 2xl:w-[32rem]";

/** 手不用离开键盘就能扫完一份名单，这三个键是全部。 */
const KEYS = [
	["/", "添加条件"],
	["↑↓", "切换员工"],
	["Esc", "关闭详情"],
] as const;

/** 理解失败时说什么。和提交失败分开：一个是这句话没读懂，一个是没送出去。 */
const INTERPRET_FAILED = "没能理解这句话，请重试或换一种说法。";

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
 * 都落在同一条记录上，必然是同一批人；而改一个筛选只动 query string，
 * 不产生新记录。
 *
 * `/s/:id` 与 `/s/:id/p/:empId` 共用这一层，检索结果挂在这里——所以换人
 * 只换详情，不重跑 SQL。
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
			<p className="text-foreground">这条搜索记录不存在</p>
			<p className="text-muted-foreground text-sm">
				链接可能已失效，或记录已被清理。
			</p>
			<Link className="text-foreground text-sm hover:underline" to="/">
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
	 * 改筛选：旧结果已经不成立了，列表该塌成骨架屏。
	 * 只是再翻一页：已经看到的人必须留在原地——列表在按下按钮的一瞬间塌掉，
	 * 等于每翻一页就把人扔回页首，滚动位置和刚才看到哪儿全没了。
	 *
	 * `location` 是导航要去的地方，`resolvedLocation` 是还挂在屏幕上的那一个；
	 * pending 期间两者不同，差别正好回答「这次导航在干什么」。两边都过一遍
	 * validateView，免得拿裸的 URL 值去比（`n` 在一边是数字一边是字符串）。
	 *
	 * 换人（`/s/x/p/a` → `/s/x/p/b`）路径也变了，但结果表一行都不用重画，
	 * 所以要先看 turn 变没变——只比 pathname 会让扫名单的每一下都把列表清空。
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

	// 键盘流的 `/` 要能聚焦到查询台那个框
	const inputRef = useRef<HTMLInputElement>(null);
	const wide = useIsWide();

	const chips = settledChips ?? [];
	const terms = result?.terms ?? [];
	const results = result?.results ?? NO_RESULTS;
	const facets = result?.facets ?? NO_FACETS;
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
	const reviseChips = (next: typeof chips) =>
		commit({ kind: "chips", chips: next }, { parentTurnId: turn.id, view });

	useKeyboardFlow({ inputRef, results, empId, turnId, view });

	return (
		/*
		 * `isolate` 是这一层最重要的一个类。
		 *
		 * coss 的 Dialog 遮罩与 Tooltip 定位器 portal 到 document.body，各自带着
		 * 一个写死的 z-50。外壳内部那三档 z（见 styles.css）最大只到 40，所以
		 * 今天它们不会打架——但那是靠「记得别超过 50」维持的，而这种约束迟早
		 * 会被一个随手写下的 z-[60] 破掉。
		 *
		 * 在这里开一个层叠上下文，把外壳内部的 z 全部关进去。关进去之后，
		 * body 下的 portal 永远画在整个外壳之上，无论内部用到多大的 z——
		 * 这类遮挡从结构上不可能发生，不必再去记那个上限。
		 */
		<div className="isolate flex min-h-dvh">
			{/* 必须是文档里第一个可聚焦元素，否则「跳过」的东西已经先被 Tab 过一遍了 */}
			<a
				className="sr-only rounded-md border bg-card px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-escape"
				href="#results"
			>
				跳到搜索结果
			</a>

			<div className="flex min-w-0 flex-1 flex-col">
				{/*
				 * 品牌行滚上去就不见了。它是身份，不是控件——把它钉死在顶上
				 * 只会在每一屏都占掉 56px 去重复一句用户早就知道的话。
				 * 真正必须一直在的是下面那块查询台，所以吸顶的是它。
				 */}
				<div className="mx-auto flex h-14 w-full max-w-page shrink-0 items-center px-4">
					<Brand />
				</div>
				<QueryDeck
					chips={chips}
					degraded={turn.degraded}
					error={commitError ?? (interpretFailed ? INTERPRET_FAILED : null)}
					fields={filterFields(facets, view)}
					inputRef={inputRef}
					interpreting={interpreting}
					loading={loading}
					onChangeQuery={reviseChips}
					onChangeView={updateView}
					onQuery={(input) => commit(input, { parentTurnId: turn.id, view })}
					onReinterpret={
						rawText
							? () => commit({ kind: "sentence", text: rawText })
							: undefined
					}
					rawText={rawText}
					strongCount={facets.strong.on}
					terms={terms}
					total={result?.total ?? 0}
					view={view}
				/>

				<main
					aria-label="搜索结果"
					className="mx-auto w-full max-w-page px-4 pt-4 pb-16"
					id="results"
					/* 跳过导航的落点必须可聚焦，否则点了链接只滚动、
					   焦点仍在链接上，下一次 Tab 又回到顶栏 */
					tabIndex={-1}
				>
					{/*
					 * 图例排在名单正上方，和它要解释的那些点同时在屏幕上。
					 * 没有条件就没有点可解释，那时它自己消失——见 evidence.tsx。
					 */}
					{terms.length > 0 && (
						<div className="mb-2.5 px-1">
							<StrengthLegend />
						</div>
					)}
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
				</main>

				{/*
				 * 快捷键写在页脚，不写在任何一个常驻的角落里。
				 *
				 * 它是「用熟之后才会用上」的东西：第一次来的人不会找它，
				 * 用熟的人记住了也不再看。挂在名单尽头，两种人都不被打扰。
				 */}
				<footer className="mx-auto flex w-full max-w-page flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pb-8 text-muted-foreground text-xs">
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
				 * 宽屏：详情**把名单推开**，不盖在上面。
				 *
				 * 推开而不是浮盖，是因为这两者要一起看——扫名单和核对证据是同一个
				 * 判断的两半，遮住一半就得反复开合。所以它是一个真正占位的兄弟节点，
				 * 名单在旁边完整可读、↑↓ 照常换人。
				 *
				 * 宽度做 transition 而不是位移：占位变了，中间那一列才会自己重新
				 * 居中。内层写死宽度、外层 `overflow-hidden`，于是收展过程中里面的
				 * 内容不会跟着被压扁再弹开。
				 *
				 * 关着的时候宽度是 0——**它在没选人的时候根本不存在**，
				 * 所以不必去想「空着的时候摆点什么」。
				 */
				<aside
					aria-label="员工详情"
					className={cn(
						"sticky top-0 h-dvh shrink-0 overflow-hidden",
						"transition-[width] duration-200 ease-out",
						open
							? `${PANEL_W} border-border border-l bg-card shadow-over`
							: "w-0",
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
