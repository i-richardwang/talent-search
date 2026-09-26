import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { QueryBarHandle } from "#/components/query-bar";
import { ConversationDrawer } from "#/routes/s/$turnId/-components/conversation-drawer";
import { DetailModal } from "#/routes/s/$turnId/-components/detail-modal";
import {
	FilterPopover,
	FilterRail,
} from "#/routes/s/$turnId/-components/filter-rail";
import { KeyHints } from "#/routes/s/$turnId/-components/key-hints";
import { QueryDeck } from "#/routes/s/$turnId/-components/query-deck";
import { ResultList } from "#/routes/s/$turnId/-components/result-list";
import { SidePanel } from "#/routes/s/$turnId/-components/side-panel";
import { Thread } from "#/routes/s/$turnId/-components/thread";
import { WorkspaceLayout } from "#/routes/s/$turnId/-components/workspace-layout";
import { filterFields, textFilters } from "#/routes/s/$turnId/-lib/filters";
import { usePicks } from "#/routes/s/$turnId/-lib/picks";
import { type View, validateView } from "#/routes/s/$turnId/-lib/view-params";
import type { SearchSpec } from "#/search/spec";
import { Routed, useOpenEmpId } from "../../routed";
import { SPEC } from "../../samples/conditions";
import { OUTCOME } from "../../samples/people";
import { LATEST_TURN_ID, TASK_TITLE, THREAD } from "../../samples/thread";
import { PersonPane } from "./detail";
import { LayoutSwitch, Shell } from "./home";

/*
 * 搜索结果页：产品的 `WorkspaceLayout` 喂样例数据。数据是样例里这次找人任务的
 * 最后一轮；筛选只改这一页的视图状态，名单不重新检索。
 */

type Panel = "thread" | "detail";

function Workspace() {
	const navigate = useNavigate();
	const empId = useOpenEmpId();
	const composer = useRef<QueryBarHandle>(null);
	const [threadOpen, setThreadOpen] = useState(false);
	const [spec, setSpec] = useState<SearchSpec>(SPEC);
	const [view, setView] = useState<View>(() => validateView({}));
	const outcome = OUTCOME;
	const fields = filterFields(outcome.facets, view);
	const texts = textFilters(view);
	const picks = usePicks(LATEST_TURN_ID, outcome);
	const noop = () => {};

	const updateView = (next: Partial<View>) =>
		setView((old) => ({ ...old, n: undefined, ...next }));

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
			onAdd={(more) => setSpec({ conditions: [...spec.conditions, ...more] })}
			onQuery={() => true}
			rounds={THREAD}
			understanding
			viewing={LATEST_TURN_ID}
			waiting={false}
		/>
	);
	const detail = empId ? <PersonPane empId={empId} /> : null;

	return (
		<WorkspaceLayout
			deck={<QueryDeck onChangeSpec={setSpec} spec={spec} title={TASK_TITLE} />}
			keys={<KeyHints editable mode="conversation" picking={picks.picking} />}
			list={
				<ResultList
					canMore={false}
					empId={empId}
					failure={null}
					growing={false}
					loading={false}
					mode="conversation"
					onAll={() => picks.pickAll(false)}
					onChange={updateView}
					onEditQuery={noop}
					onMore={noop}
					onReviseQuery={(conditions) => setSpec({ conditions })}
					outcome={outcome}
					phase="searching"
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
			rail={
				<FilterRail
					fields={fields}
					loading={false}
					onChange={updateView}
					textFilters={texts}
				/>
			}
			filterButton={
				<FilterPopover
					fields={fields}
					loading={false}
					onChange={updateView}
					textFilters={texts}
				/>
			}
			conversationDrawer={
				<ConversationDrawer onOpenChange={setThreadOpen} open={threadOpen}>
					{conversation}
				</ConversationDrawer>
			}
		/>
	);
}

/** 页底切换：右栏显示对话线程还是第一位候选人的详情。点名单上的人也会换过去。 */
function PanelSwitch() {
	const navigate = useNavigate();
	const empId = useOpenEmpId();
	const first = OUTCOME.results[0]?.employee.empId ?? "T0101";
	return (
		<LayoutSwitch<Panel>
			label="右栏"
			onChange={(next) =>
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
				)
			}
			options={[
				{ label: "右栏：对话线程", value: "thread" },
				{ label: "右栏：人的详情", value: "detail" },
			]}
			value={empId ? "detail" : "thread"}
		/>
	);
}

/** 搜索结果页：查询带、左筛选栏、名单、右栏，右栏在对话线程和人的详情之间切换。 */
export function WorkspacePage() {
	return (
		<Routed url={`/s/${LATEST_TURN_ID}`}>
			<Shell>
				<Workspace />
			</Shell>
			<PanelSwitch />
		</Routed>
	);
}
