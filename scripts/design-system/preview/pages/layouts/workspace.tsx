import { useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { QueryBarHandle } from "#/components/query-bar";
import { ConversationDrawer } from "#/routes/s/$turnId/-components/conversation-drawer";
import { DetailModal } from "#/routes/s/$turnId/-components/detail-modal";
import { KeyHelp } from "#/routes/s/$turnId/-components/key-help";
import { QueryHeader } from "#/routes/s/$turnId/-components/query-header";
import { ResultList } from "#/routes/s/$turnId/-components/result-list";
import { SidePanel } from "#/routes/s/$turnId/-components/side-panel";
import { Thread } from "#/routes/s/$turnId/-components/thread";
import { WorkspaceLayout } from "#/routes/s/$turnId/-components/workspace-layout";
import { WorkspaceNotices } from "#/routes/s/$turnId/-components/workspace-notices";
import { useIsWide } from "#/routes/s/$turnId/-lib/media";
import { listWait } from "#/routes/s/$turnId/-lib/nav-phase";
import { usePicks } from "#/routes/s/$turnId/-lib/picks";
import { type View, validateView } from "#/routes/s/$turnId/-lib/view-params";
import { queryOfSpec, type SearchSpec } from "#/search/spec";
import { Routed, useOpenEmpId } from "../../routed";
import { SPEC } from "../../samples/conditions";
import { INCOMPLETE_OUTCOME, OUTCOME } from "../../samples/people";
import {
	COMPLETING_TRACE,
	COMPLETING_TURN,
	LATEST_TURN,
	LATEST_TURN_ID,
	TASK_TITLE,
	THREAD,
} from "../../samples/thread";
import { PersonPane } from "./detail";
import { LayoutSwitch, Shell } from "./home";

/*
 * 搜索结果页：产品的 `WorkspaceLayout` 配上样例数据。数据是样例里这次找人任务的
 * 最后一轮。名单上方是条件那一排和筛选；筛选和名单一样读写内存 router 地址上的视图，
 * 但名单不重新检索。
 */

/**
 * 页底切换的几种样子：前两种换右栏，后三种是名单还不完整的时候——候选人较多、
 * HR 直接改了条件 AI 正在补人、补人没成。
 */
type Scene = "thread" | "detail" | "incomplete" | "completing" | "notCompleted";

/** 名单那一侧的状态；右栏放什么由地址决定。 */
type ListScene = Exclude<Scene, "detail">;

/** 没有导航在进行。 */
const STILL = { growing: false, refreshing: false, replacing: false };

function Workspace({ scene }: { scene: ListScene }) {
	const navigate = useNavigate();
	const empId = useOpenEmpId();
	const wide = useIsWide();
	const composer = useRef<QueryBarHandle>(null);
	const [threadOpen, setThreadOpen] = useState(false);
	const [help, setHelp] = useState(false);
	const [spec, setSpec] = useState<SearchSpec>(SPEC);
	const outcome = scene === "incomplete" ? INCOMPLETE_OUTCOME : OUTCOME;
	const completing = scene === "completing";
	const notCompleted = scene === "notCompleted";
	// 补人是最后一轮自己的处理：线程那一轮底下画过程，没补成时给重试
	const latest = completing || notCompleted ? COMPLETING_TURN : LATEST_TURN;
	const progress = completing
		? { trace: COMPLETING_TRACE, startedAt: latest.startedAt }
		: notCompleted
			? { trace: [], startedAt: latest.startedAt }
			: null;
	const view = validateView(useSearch({ strict: false }));
	const picks = usePicks(LATEST_TURN_ID, outcome);
	const noop = () => {};

	const updateView = (next: Partial<View>) =>
		void navigate({
			search: (old) => ({ ...validateView(old), n: undefined, ...next }),
			to: ".",
		});

	const close = () =>
		void navigate({
			params: { turnId: LATEST_TURN_ID },
			replace: true,
			search: {},
			to: "/s/$turnId",
		});

	const conversation = (
		<Thread
			autoFocus={threadOpen}
			composer={composer}
			earlier={THREAD.slice(0, -1)}
			fault={notCompleted ? "unreachable" : null}
			latest={latest}
			onAnswer={() => true}
			onQuery={() => true}
			onRetry={noop}
			progress={progress}
			understanding
			viewing={LATEST_TURN_ID}
			waiting={false}
		/>
	);
	const detail = empId ? <PersonPane empId={empId} /> : null;

	return (
		<>
			<WorkspaceLayout
				header={
					<QueryHeader
						onHelp={() => setHelp(true)}
						right={
							!wide && (
								<ConversationDrawer
									onOpenChange={setThreadOpen}
									open={threadOpen}
								>
									{conversation}
								</ConversationDrawer>
							)
						}
						title={TASK_TITLE}
					/>
				}
				notices={
					<WorkspaceNotices
						conditions={{
							mode: "conversation",
							list: queryOfSpec(spec).conditions,
							onRevise: (conditions) => {
								setSpec({ query: { conditions } });
								return true;
							},
						}}
						earlier={false}
						facets={outcome.facets}
						incomplete={outcome.incomplete ?? null}
						latestId={LATEST_TURN_ID}
						notCompleted={
							notCompleted ? { fault: "unreachable", onRetry: noop } : null
						}
						onViewChange={updateView}
						turnId={LATEST_TURN_ID}
						view={view}
					/>
				}
				list={
					<ResultList
						canMore={false}
						empId={empId}
						failure={null}
						growing={false}
						wait={
							completing
								? listWait("completing", latest.startedAt, STILL)
								: null
						}
						mode="conversation"
						onAll={() => picks.pickAll(false)}
						onChange={updateView}
						onEditQuery={noop}
						onMore={noop}
						onReviseQuery={(conditions) => setSpec({ query: { conditions } })}
						outcome={outcome}
						picks={picks}
						spec={spec}
						turnId={LATEST_TURN_ID}
					/>
				}
				panel={<SidePanel conversation={conversation} detail={detail} />}
				detailModal={
					<DetailModal onClose={close} open={Boolean(empId)}>
						{detail}
					</DetailModal>
				}
			/>
			<KeyHelp
				editable
				mode="conversation"
				onClose={() => setHelp(false)}
				open={help}
			/>
		</>
	);
}

/**
 * 页底切换：右栏显示对话线程还是第一位候选人的详情（点名单上的人也会换过去），
 * 以及名单还不完整的三种时候。后三种的右栏是线程。
 */
function SceneSwitch({
	onChange,
	scene,
}: {
	onChange: (next: ListScene) => void;
	scene: ListScene;
}) {
	const navigate = useNavigate();
	const empId = useOpenEmpId();
	const first = OUTCOME.results[0]?.employee.empId ?? "T0101";
	return (
		<LayoutSwitch<Scene>
			label="工作台的状态"
			onChange={(next) => {
				if (next !== "detail") onChange(next);
				void navigate(
					next === "detail"
						? {
								params: { empId: empId ?? first, turnId: LATEST_TURN_ID },
								replace: true,
								to: "/s/$turnId/p/$empId",
							}
						: {
								params: { turnId: LATEST_TURN_ID },
								replace: true,
								search: {},
								to: "/s/$turnId",
							},
				);
			}}
			options={[
				{ label: "右栏：对话线程", value: "thread" },
				{ label: "右栏：人的详情", value: "detail" },
				{ label: "候选人较多", value: "incomplete" },
				{ label: "改条件后补人", value: "completing" },
				{ label: "补人没成", value: "notCompleted" },
			]}
			value={empId ? "detail" : scene}
		/>
	);
}

export function WorkspacePage() {
	const [scene, setScene] = useState<ListScene>("thread");
	return (
		<Routed url={`/s/${LATEST_TURN_ID}`}>
			<Shell>
				<Workspace scene={scene} />
			</Shell>
			<SceneSwitch onChange={setScene} scene={scene} />
		</Routed>
	);
}
