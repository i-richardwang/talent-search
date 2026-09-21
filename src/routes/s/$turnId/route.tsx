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

const PANEL_W = "w-detail 2xl:w-detail-wide";

const KEYS = [
	["/", "改问题"],
	["↑↓", "切换员工"],
	["Esc", "关闭详情"],
] as const;

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

function Workbench() {
	const { turn, result } = Route.useLoaderData();
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

	const deck = useRef<QueryDeckHandle>(null);
	const editQuery = useCallback(() => deck.current?.edit(), []);
	const wide = useIsWide();

	const spec = settledSpec ?? EMPTY_SPEC;
	const outcome = result ?? NO_OUTCOME;
	const { results, facets, total } = outcome;
	const fields = filterFields(facets, view);
	const texts = textFilters(view);
	const loading = navigating || interpreting;
	const phase = interpreting ? "interpreting" : "searching";
	const open = Boolean(empId);

	const updateView = (next: Partial<View>) =>
		navigate({ to: ".", search: (old) => ({ ...old, n: undefined, ...next }) });

	const reviseSpec = (next: SearchSpec) =>
		commit({ kind: "spec", spec: next }, { parentTurnId: turnId });

	const picks = usePicks(turnId, outcome);

	const canMore = canLoadMore(view, total);

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
						{(picks.picking ? [...KEYS, PICK_KEY] : KEYS).map(([key, what]) => (
							<span className="flex items-center gap-1.5" key={key}>
								<Kbd>{key}</Kbd>
								{what}
							</span>
						))}
					</footer>
				</div>

				{wide ? (
					<aside
						aria-label="员工详情"
						className={cn(
							"sticky top-(--chrome-height) h-[calc(100dvh-var(--chrome-height))] shrink-0 overflow-hidden",
							"transition-[width] duration-200 ease-out",
							"max-xl:hidden",
							open ? `${PANEL_W} border-border border-l bg-card` : "w-0",
						)}
					>
						<div className={cn(PANEL_W, "h-full")}>
							<ScrollArea overscrollContain>
								<Outlet />
							</ScrollArea>
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
