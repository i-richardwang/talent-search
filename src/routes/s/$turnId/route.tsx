import {
	createFileRoute,
	notFound,
	Outlet,
	useLoaderData,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { KeywordBar } from "#/components/keyword-bar";
import { Alert } from "#/components/ui/alert";
import type { Condition } from "#/search/condition";
import { keywordsOf, keywordTitle } from "#/search/keywords";
import { emptyFacets, type SearchOutcome } from "#/search/result";
import { emptySpec, type SearchSpec } from "#/search/spec";
import { loadWorkbench } from "#/server/functions";
import { TurnNotFound } from "../../-components/not-found";
import { useCommit } from "../../-lib/commit";
import { ConversationDrawer } from "./-components/conversation-drawer";
import { DetailModal } from "./-components/detail-modal";
import { Earlier } from "./-components/earlier";
import { KeyHints } from "./-components/key-hints";
import { QueryHeader } from "./-components/query-header";
import { ResultList } from "./-components/result-list";
import { SidePanel } from "./-components/side-panel";
import { Thread } from "./-components/thread";
import { WorkbenchNav } from "./-components/workbench-nav";
import { WorkspaceLayout } from "./-components/workspace-layout";
import { useCloseDetail, useEditQuery } from "./-lib/edit-query";
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

// 引用不变，键盘监听不会在结果回来之前反复重绑。
const NO_OUTCOME: SearchOutcome = {
	order: "evidence",
	claims: [],
	results: [],
	facets: emptyFacets(),
	total: 0,
	empty: null,
};
const EMPTY_SPEC = emptySpec();

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
	staticData: { nav: WorkbenchNav },
	component: Workbench,
	notFoundComponent: TurnNotFound,
});

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
	const wide = useIsWide();
	const open = Boolean(empId);
	const closeDetail = useCloseDetail(turnId, view);
	const { composer, editQuery, keywordBar, setThreadOpen, threadOpen } =
		useEditQuery({ closeDetail, mode, open, wide });

	const spec = settledSpec ?? EMPTY_SPEC;
	const outcome = result ?? NO_OUTCOME;
	const { results, total } = outcome;
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
		onPick: picks.toggle,
		results,
		empId,
		turnId,
		view,
	});

	return (
		<WorkspaceLayout
			header={
				<QueryHeader
					onChangeSpec={mode === "conversation" ? reviseSpec : undefined}
					right={
						!wide &&
						conversation && (
							<ConversationDrawer
								onOpenChange={setThreadOpen}
								open={threadOpen}
							>
								{conversation}
							</ConversationDrawer>
						)
					}
					spec={settledSpec}
					title={
						mode === "conversation"
							? turn.title
							: keywords && keywordTitle(keywords)
					}
				/>
			}
			keys={<KeyHints editable={editable} mode={mode} />}
			list={
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
					onAll={pickAll}
					onChange={updateView}
					onEditQuery={editQuery}
					onMore={() => updateView(morePage(view))}
					onReviseQuery={(conditions) => reviseSpec({ conditions })}
					outcome={outcome}
					phase={phase}
					picks={picks}
					spec={spec}
					turnId={turnId}
				/>
			}
			notices={
				/* 关键词搜索的框在名单正上方：改完第一眼看到的是它改了什么，
				   再往下才是人。对话不在这里，在右栏的线程里。 */
				(earlier || mode === "keyword" || commitError) && (
					<>
						{earlier && <Earlier latestId={latest.id} />}
						{mode === "keyword" && (
							<KeywordBar
								initial={keywords ?? undefined}
								key={turnId}
								onSearch={(conditions) => reviseSpec({ conditions })}
								ref={keywordBar}
							/>
						)}
						{commitError && <Alert title={commitError} type="error" />}
					</>
				)
			}
			panel={
				<SidePanel
					conversation={conversation}
					detail={open ? <Outlet /> : null}
				/>
			}
			detailModal={
				<DetailModal onClose={() => void closeDetail()} open={open}>
					<Outlet />
				</DetailModal>
			}
		/>
	);
}
