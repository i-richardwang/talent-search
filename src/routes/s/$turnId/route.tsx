import {
	createFileRoute,
	notFound,
	Outlet,
	useLoaderData,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "#/components/ui/toast";
import type { Condition } from "#/search/condition";
import { keywordsOf, keywordTitle } from "#/search/keywords";
import type { QueryCondition } from "#/search/query";
import { emptyFacets, type SearchOutcome } from "#/search/result";
import { emptySpec, queryOfSpec, type SearchSpec } from "#/search/spec";
import { loadWorkbench } from "#/server/functions";
import { TurnNotFound } from "../../-components/not-found";
import { useCommit } from "../../-lib/commit";
import { ConversationDrawer } from "./-components/conversation-drawer";
import { DetailModal } from "./-components/detail-modal";
import { KeyHelp } from "./-components/key-help";
import { QueryHeader } from "./-components/query-header";
import { ResultList } from "./-components/result-list";
import { SidePanel } from "./-components/side-panel";
import { answerAt, Thread } from "./-components/thread";
import { WorkspaceLayout } from "./-components/workspace-layout";
import { WorkspaceNotices } from "./-components/workspace-notices";
import { useAttempt } from "./-lib/attempt";
import { useCloseDetail, useEditQuery } from "./-lib/edit-query";
import { useKeyboardFlow } from "./-lib/keyboard-flow";
import { useIsWide } from "./-lib/media";
import { listWait, useNavPhase } from "./-lib/nav-phase";
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
	// 动作没提交上去：名单没变，说一句、让人再点一次
	useEffect(() => {
		if (commitError) toast.error(commitError);
	}, [commitError]);

	const nav = useNavPhase();
	// AI 的处理属于链上最后一轮，不属于正看着的这一轮：回头看早先的结果时，
	// 最后一轮照样在处理，线程照样在追加步骤
	const {
		working,
		fault: attemptFault,
		retry: retryAttempt,
		progress,
	} = useAttempt(latest);
	// 没理解出来的只可能是最后一轮；名单停在等待或失败，只当看着的就是它
	const pending = settledSpec === null;
	// 看着的是最后一轮、条件已经有了：AI 要做的只剩补上新进范围的人
	const completable = !pending && !earlier;

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
	// 名单上有人时，读到第一批经历才算在补人：改完没有新进范围的人时这一次转眼就结束，不提示。
	// 名单是空的就一直算：没补完之前不能说没有这样的人
	const completing =
		completable &&
		working &&
		((progress?.trace.length ?? 0) > 0 || results.length === 0);
	// AI 没处理成：名单上没有人可看时说在名单那一列，有人时名单照常、说在名单上方
	const failed =
		!earlier && attemptFault
			? { fault: attemptFault, onRetry: retryAttempt }
			: null;
	const wait = listWait(
		pending && working ? "understanding" : completing ? "completing" : null,
		progress?.startedAt ?? null,
		nav,
	);

	const updateView = (next: Partial<View>) =>
		navigate({ to: ".", search: (old) => ({ ...old, n: undefined, ...next }) });

	const keywords =
		mode === "keyword" && "conditions" in spec
			? keywordsOf(spec.conditions)
			: null;
	const query = queryOfSpec(spec);

	const reviseSpec = (next: SearchSpec) =>
		commit({ kind: "spec", spec: next }, { from: turnId });

	/** 对话的条件在 chip 上改，改完是一份查询；关键词的条件在框里改。 */
	const reviseTo = (conditions: QueryCondition[]) =>
		reviseSpec({ query: { conditions } });
	const reviseKeywords = (conditions: Condition[]) =>
		reviseSpec({ conditions });

	// AI 问的是最后一轮的条件，回答接在最后一轮后面，看着哪一轮都一样
	const answer = (text: string) =>
		commit({ kind: "sentence", text }, { from: latest.id });
	// 最后一轮 AI 问的那一问：按选项前的数字选。线程看不见时不接
	const choices =
		latest.spec && (wide || threadOpen) ? latest.notes?.choices : null;
	const choose =
		choices &&
		((n: number) => {
			const picked = answerAt(choices, n);
			if (picked) answer(picked);
		});

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
			earlier={thread.slice(0, -1)}
			fault={attemptFault}
			latest={latest}
			progress={progress}
			onAnswer={answer}
			onQuery={(input) => commit(input, { from: turnId })}
			onRetry={retryAttempt}
			understanding={understanding}
			viewing={turnId}
			waiting={working && latest.spec === null}
		/>
	);

	const [help, setHelp] = useState(false);

	useKeyboardFlow({
		onChoose: choose ?? undefined,
		onClearPicks: picks.clear,
		onCloseDetail: closeDetail,
		onEditQuery: editQuery,
		onHelp: () => setHelp(true),
		onPick: picks.toggle,
		picked: picks.picked.size,
		results,
		empId,
		turnId,
		view,
	});

	return (
		<>
			<WorkspaceLayout
				header={
					<QueryHeader
						onHelp={() => setHelp(true)}
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
						title={
							mode === "conversation"
								? turn.title
								: keywords && keywordTitle(keywords)
						}
					/>
				}
				list={
					<ResultList
						canMore={canMore}
						empId={empId}
						failure={results.length === 0 ? failed : null}
						growing={nav.growing}
						mode={mode}
						onAll={pickAll}
						onChange={updateView}
						onEditQuery={editQuery}
						onMore={() => updateView(morePage(view))}
						onReviseQuery={reviseTo}
						outcome={outcome}
						picks={picks}
						spec={spec}
						turnId={turnId}
						wait={wait}
					/>
				}
				notices={
					<WorkspaceNotices
						conditions={
							mode === "conversation"
								? {
										mode,
										list: query.conditions,
										onRevise: reviseTo,
									}
								: {
										mode,
										keywords,
										onSearch: reviseKeywords,
										bar: keywordBar,
									}
						}
						earlier={earlier}
						facets={outcome.facets}
						incomplete={
							// 空名单的原因在空态里说；还在补人时这句话还没定
							results.length > 0 && !(completable && working)
								? (outcome.incomplete ?? null)
								: null
						}
						notCompleted={results.length > 0 ? failed : null}
						latestId={latest.id}
						onViewChange={updateView}
						turnId={turnId}
						view={view}
					/>
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
			<KeyHelp
				editable={editable}
				mode={mode}
				onClose={() => setHelp(false)}
				open={help}
			/>
		</>
	);
}
