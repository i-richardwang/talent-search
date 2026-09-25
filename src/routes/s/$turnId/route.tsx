import {
	createFileRoute,
	Link,
	notFound,
	Outlet,
	useLoaderData,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { AlertCircleIcon, HistoryIcon, MessagesSquareIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { KeywordBar, type KeywordBarHandle } from "#/components/keyword-bar";
import type { QueryBarHandle } from "#/components/query-bar";
import { Alert, AlertAction, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogPanel,
	DialogPopup,
	DialogTitle,
} from "#/components/ui/dialog";
import { Kbd } from "#/components/ui/kbd";
import { ScrollArea } from "#/components/ui/scroll-area";
import {
	Sheet,
	SheetPopup,
	SheetTitle,
	SheetTrigger,
} from "#/components/ui/sheet";
import { cn } from "#/lib/utils";
import type { Condition } from "#/search/condition";
import { keywordsOf, keywordTitle } from "#/search/keywords";
import { emptyFacets, type SearchOutcome } from "#/search/result";
import { emptySpec, type SearchSpec } from "#/search/spec";
import { loadWorkbench } from "#/server/functions";
import { DeadEnd } from "../../-components/dead-end";
import { useCommit } from "../../-lib/commit";
import { FilterRail, FilterSheet } from "./-components/filter-rail";
import { QueryDeck } from "./-components/query-deck";
import { ResultList } from "./-components/result-list";
import { Thread } from "./-components/thread";
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

// Stable identity prevents keyboard listeners from rebinding before results exist.
const NO_OUTCOME: SearchOutcome = {
	order: "evidence",
	claims: [],
	results: [],
	facets: emptyFacets(),
	total: 0,
	empty: null,
};
const EMPTY_SPEC = emptySpec();

/** 右栏的宽度：对话线程和人的详情共用这一个槽（`styles.css` 的 `--container-detail`）。 */
const PANEL_W = "w-detail 2xl:w-detail-wide";

const KEYS = [
	["↑↓", "切换员工"],
	["Esc", "关闭详情"],
] as const;

/** 「/」把光标放进改查询的地方：AI 搜索是右栏的输入框，关键词是「经历或技能」。 */
const EDIT_KEY = {
	conversation: ["/", "修改需求"],
	keyword: ["/", "改关键词"],
} as const;

const PICK_KEY = ["空格", "选择或取消"] as const;

export const Route = createFileRoute("/s/$turnId")({
	validateSearch: validateView,
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

/**
 * 正看着的不是最后一次的结果。名单那一列说出来：窄屏上线程收着，只有这里看得见。
 * 在这里改条件、补充需求照常可以，作用在眼前这份条件上，记在最后。
 */
function Earlier({ latestId }: { latestId: string }) {
	return (
		<Alert>
			<HistoryIcon />
			<AlertDescription>
				正在查看较早的一次结果。在此基础上修改，会记为最新的一次。
			</AlertDescription>
			<AlertAction>
				<Button
					render={
						<Link params={{ turnId: latestId }} search={{}} to="/s/$turnId" />
					}
					size="xs"
					variant="outline"
				>
					回到最新
				</Button>
			</AlertAction>
		</Alert>
	);
}

function Workbench() {
	const { thread, result } = Route.useLoaderData();
	const { turnId } = Route.useParams();
	const { understanding } = useLoaderData({ from: "__root__" });
	// loader 保证线程非空、正看着的这一轮在链上
	const turn = thread.find((t) => t.id === turnId) as (typeof thread)[number];
	const latest = thread[thread.length - 1] as (typeof thread)[number];
	const earlier = latest.id !== turnId;
	const { spec: settledSpec } = turn;
	const view = Route.useSearch();
	const navigate = useNavigate();
	const { empId } = useParams({ strict: false });
	const { commit, error: commitError } = useCommit();

	const { growing, navigating } = useNavPhase();
	// 理解属于链上最后一轮，不属于正看着的这一轮：回头看早先的结果时，
	// 最后一轮照样在理解，线程照样在长
	const {
		interpreting,
		fault: interpretFault,
		retry: retryInterpret,
		trace: liveTrace,
	} = useInterpretation(latest.id, latest.spec);
	// 没理解出来的只可能是最后一轮；名单停在等待或失败，只当看着的就是它
	const pending = settledSpec === null;

	const { mode } = turn;
	// 对话的链在没配查询理解时没有输入框，条件只能在 chip 上改
	const editable = mode === "keyword" || understanding;
	const composer = useRef<QueryBarHandle>(null);
	const keywordBar = useRef<KeywordBarHandle>(null);
	const wide = useIsWide();
	const open = Boolean(empId);
	// 窄屏上对话栏收成一张 Sheet；「/」要先把它打开
	const [threadOpen, setThreadOpen] = useState(false);
	const editQuery = useCallback(async () => {
		if (mode === "keyword") {
			keywordBar.current?.focus();
			return;
		}
		if (!wide) {
			setThreadOpen(true);
			return;
		}
		// 对话栏和详情共用右栏：读着一个人时按「/」，先把详情收起来
		if (open)
			await navigate({
				to: "/s/$turnId",
				params: { turnId },
				search: view,
				replace: true,
			});
		composer.current?.focus();
	}, [mode, wide, open, navigate, turnId, view]);

	const spec = settledSpec ?? EMPTY_SPEC;
	const outcome = result ?? NO_OUTCOME;
	const { results, facets, total } = outcome;
	const fields = filterFields(facets, view);
	const texts = textFilters(view);
	const loading = navigating || (pending && interpreting);
	const phase = pending && interpreting ? "interpreting" : "searching";

	const updateView = (next: Partial<View>) =>
		navigate({ to: ".", search: (old) => ({ ...old, n: undefined, ...next }) });

	const keywords = mode === "keyword" ? keywordsOf(spec.conditions) : null;

	const reviseSpec = (next: SearchSpec) =>
		commit({ kind: "spec", spec: next }, { from: turnId });

	const addConditions = (more: Condition[]) =>
		reviseSpec({ conditions: [...spec.conditions, ...more] });

	const picks = usePicks(turnId, outcome);

	const canMore = canLoadMore(view, total);

	const pickAll = () => {
		picks.pickAll(canMore);
		if (canMore) updateView(allPages(total));
	};

	// 对话的链才有线程；没配查询理解时线程只能看，不能补充需求
	const conversation = mode === "conversation" && (
		<Thread
			autoFocus={threadOpen}
			composer={composer}
			fault={interpretFault}
			liveTrace={liveTrace}
			onAdd={addConditions}
			onQuery={(input) => commit(input, { from: turnId })}
			rounds={thread}
			understanding={understanding}
			viewing={turnId}
			waiting={interpreting}
		/>
	);

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
			<QueryDeck
				onChangeSpec={mode === "conversation" ? reviseSpec : undefined}
				spec={settledSpec}
				title={
					mode === "conversation"
						? turn.title
						: keywords && keywordTitle(keywords)
				}
			/>
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
						className="mx-auto w-full max-w-page px-4 pt-4 pb-16"
						id="main"
						tabIndex={-1}
					>
						{/* 关键词搜索的框在名单正上方：改完第一眼看到的是它改了什么，
						    再往下才是人。对话不在这里，在右栏的线程里。 */}
						{(earlier || mode === "keyword" || commitError) && (
							<div className="mb-4 flex flex-col gap-3">
								{earlier && <Earlier latestId={latest.id} />}
								{mode === "keyword" && (
									<KeywordBar
										initial={keywords ?? undefined}
										key={turnId}
										onSearch={(conditions) => reviseSpec({ conditions })}
										ref={keywordBar}
									/>
								)}
								{commitError && (
									<Alert variant="error">
										<AlertCircleIcon />
										<AlertDescription>{commitError}</AlertDescription>
									</Alert>
								)}
							</div>
						)}

						<div className="mb-3 flex flex-wrap gap-2">
							<div className="lg:hidden">
								<FilterSheet
									fields={fields}
									loading={loading}
									onChange={updateView}
									textFilters={texts}
								/>
							</div>
							{/* 窄屏上对话栏收成一张 Sheet。只在 JS 判定窄时挂：Sheet 是模态，
							    藏起来也抓焦点；`xl:hidden` 兜住 JS 还没说话的首帧。 */}
							{!wide && conversation && (
								<div className="xl:hidden">
									<Sheet onOpenChange={setThreadOpen} open={threadOpen}>
										<SheetTrigger
											render={
												<Button size="sm" variant="outline">
													<MessagesSquareIcon />
													对话
												</Button>
											}
										/>
										<SheetPopup className="max-w-md">
											<SheetTitle className="sr-only">对话</SheetTitle>
											{conversation}
										</SheetPopup>
									</Sheet>
								</div>
							)}
						</div>

						<ResultList
							canMore={canMore}
							empId={empId}
							failure={
								pending && interpretFault
									? { fault: interpretFault, onRetry: retryInterpret }
									: null
							}
							growing={growing}
							loading={loading}
							mode={mode}
							onChange={updateView}
							onEditQuery={editQuery}
							phase={phase}
							onAll={pickAll}
							onMore={() => updateView(morePage(view))}
							onReviseQuery={(conditions) => reviseSpec({ conditions })}
							outcome={outcome}
							picks={picks}
							spec={spec}
							turnId={turnId}
						/>
					</main>
					<footer className="mx-auto hidden w-full max-w-page flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pb-8 text-muted-foreground text-xs pointer-fine:flex">
						{[
							...(editable ? [EDIT_KEY[mode]] : []),
							...KEYS,
							...(picks.picking ? [PICK_KEY] : []),
						].map(([key, what]) => (
							<span className="flex items-center gap-1.5" key={key}>
								<Kbd>{key}</Kbd>
								{what}
							</span>
						))}
					</footer>
				</div>

				{wide ? (
					/*
					 * 右栏：对话的链上常驻线程，点开一个人时换成那个人的详情，关掉
					 * 详情线程回来。两样都要常驻但不必同时在场：名单和详情才是要反复
					 * 对照的一对，线程看完一轮就回到名单。关键词的链没有线程，
					 * 右栏只在点开人时才有宽度。
					 */
					<aside
						aria-label={open ? "员工详情" : "对话"}
						className={cn(
							"sticky top-(--chrome-height) h-[calc(100dvh-var(--chrome-height))] shrink-0 overflow-hidden",
							"transition-[width] duration-200 ease-out",
							"max-xl:hidden",
							open || conversation
								? `${PANEL_W} border-border border-l bg-card`
								: "w-0",
						)}
					>
						<div className={cn(PANEL_W, "h-full")}>
							{open ? (
								<ScrollArea overscrollContain>
									<Outlet />
								</ScrollArea>
							) : (
								conversation
							)}
						</div>
					</aside>
				) : (
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
