import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Segmented } from "#/components/ui/segmented";
import { EmployeeRecord } from "#/routes/data/-components/employee-drawer";
import { DetailModal } from "#/routes/s/$turnId/-components/detail-modal";
import { ResultList } from "#/routes/s/$turnId/-components/result-list";
import { SidePanel } from "#/routes/s/$turnId/-components/side-panel";
import { Thread } from "#/routes/s/$turnId/-components/thread";
import { usePicks } from "#/routes/s/$turnId/-lib/picks";
import { TermRecord } from "#/routes/skills/-components/term-drawer";
import { TaskCard } from "#/routes/tasks/-components/task-card";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Stage } from "../../kit/stage";
import { Routed, useOpenEmpId } from "../../routed";
import {
	CORPUS_COUNTS,
	SEGMENTS,
	SKILL_DETAIL,
	TASK_LANES,
} from "../../samples/admin";
import { SPEC } from "../../samples/conditions";
import { EMPLOYEES, OUTCOME } from "../../samples/people";
import { LATEST_TURN_ID, THREAD } from "../../samples/thread";
import { PersonPane } from "../layouts/detail";

/* ---------- 抽屉：数据页的人、技能页的词 ---------- */

/** 数据页点开 Talent 0101：登记的内容和解析出的技能、职责并排。 */
function PersonDrawer({ close }: { close: () => void }) {
	const employee = EMPLOYEES[0];
	if (!employee) return null;
	return (
		<EmployeeRecord close={close} employee={employee} segments={SEGMENTS} />
	);
}

function Drawers() {
	const [open, setOpen] = useState<"person" | "term" | null>(null);
	const close = () => setOpen(null);
	return (
		<Stage
			footer={
				<span>
					底下的表保持原样，关掉抽屉接着看下一行；抽屉滑回右边之后才回到列表地址
				</span>
			}
		>
			<div className="flex flex-wrap justify-center gap-3">
				<Button onClick={() => setOpen("person")}>
					数据页：打开 Talent 0101
				</Button>
				<Button onClick={() => setOpen("term")}>
					技能页：打开「推荐系统」
				</Button>
			</div>
			<Routed url="/skills">
				{open === "person" && <PersonDrawer close={close} />}
				{open === "term" && <TermRecord close={close} term={SKILL_DETAIL} />}
			</Routed>
		</Stage>
	);
}

/* ---------- 任务日志：按次打开才取 ---------- */

/** 同步那一栏的运行记录。 */
const SYNC_LANE = TASK_LANES.find((lane) => lane.kind === "sync");

function Logs() {
	return (
		<div className="flex flex-col gap-3">
			<Routed url="/tasks">
				<ul>
					{SYNC_LANE && (
						<TaskCard
							busy={false}
							corpus={CORPUS_COUNTS}
							judge="model"
							lane={SYNC_LANE}
							onDone={() => {}}
						/>
					)}
				</ul>
			</Routed>
			<p className="text-fg-secondary text-xs">
				设计系统不连服务端：打开「日志」时取日志失败，抽屉里说取不到。
			</p>
		</div>
	);
}

/* ---------- 人的详情：名单旁的右栏，窄屏是弹窗 ---------- */

/** 名单：每一行是通往详情的真链接。 */
function Names({ selected }: { selected: string | undefined }) {
	const picks = usePicks(LATEST_TURN_ID, OUTCOME);
	const noop = () => {};
	return (
		<ResultList
			canMore={false}
			empId={selected}
			growing={false}
			wait={null}
			mode="conversation"
			onAll={noop}
			onChange={noop}
			onEditQuery={noop}
			onMore={noop}
			onReviseQuery={noop}
			outcome={OUTCOME}
			picks={picks}
			spec={SPEC}
			turnId={LATEST_TURN_ID}
		/>
	);
}

/** 宽屏：名单和产品的右栏并排，右栏平时是对话线程，点开人换成详情。 */
function Wide() {
	const empId = useOpenEmpId();
	return (
		<div className="flex h-160 overflow-hidden">
			<div className="min-w-0 flex-1 overflow-y-auto p-4">
				<Names selected={empId} />
			</div>
			<SidePanel
				conversation={
					<Thread
						onAdd={() => {}}
						onQuery={() => true}
						rounds={THREAD}
						understanding
						viewing={LATEST_TURN_ID}
						waiting={false}
					/>
				}
				detail={empId ? <PersonPane empId={empId} /> : null}
			/>
		</div>
	);
}

/** 窄屏：没有右栏，点开人是产品的详情浮层，关掉回到名单。 */
function Narrow() {
	const empId = useOpenEmpId();
	const router = useRouter();
	return (
		<div className="p-4">
			<Names selected={empId} />
			<DetailModal
				onClose={() =>
					void router.navigate({
						params: { turnId: LATEST_TURN_ID },
						replace: true,
						to: "/s/$turnId",
					})
				}
				open={Boolean(empId)}
			>
				{empId && <PersonPane empId={empId} />}
			</DetailModal>
		</div>
	);
}

function Side() {
	const [layout, setLayout] = useState<"wide" | "narrow">("wide");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="屏幕宽度">
					<Segmented<"wide" | "narrow">
						onChange={setLayout}
						options={[
							{ label: "宽屏：右栏", value: "wide" },
							{ label: "窄屏：弹窗", value: "narrow" },
						]}
						value={layout}
					/>
				</Control>
			</Controls>
			<Stage
				className="items-stretch p-0"
				footer={<span>点名单上的名字打开详情；关闭回到名单，名单不动</span>}
			>
				<Routed key={layout} url={`/s/${LATEST_TURN_ID}`}>
					{layout === "wide" ? <Wide /> : <Narrow />}
				</Routed>
			</Stage>
		</div>
	);
}

/** 查看详情：管理页的抽屉、任务日志的抽屉，以及名单旁的人的详情。 */
export function ReadingPage() {
	return (
		<DocPage
			facts={["抽屉", "日志抽屉", "右栏与弹窗"]}
			rules={{
				notes: [
					"一次阅读用 Drawer，两侧反复对照才用并列栏。",
					"管理页的抽屉由地址决定开合：滑回右边之后才导航回列表，搜索词和页码原样保留。",
					"任务的原始输出不做页面内容，按次收在「日志」抽屉里，打开才取。",
					"名单页的右栏由对话线程和人的详情共用：点开人时换成详情，关掉回到线程；窄屏上是弹窗。两样顶上都是一条页头，详情的页头写着姓名和工号，滚到哪都在。",
					"一个对象的几条属性用 Descriptions：抽屉里的词、数据页的一段经历、右栏的人，写法同一种。",
					"整块可点的名单行是真链接，支持中键、右键和键盘；详情里不画名单上已有的分数和名次。",
				],
				usage: `<DetailDrawer\n  close={() => navigate({ search, to: "/data" })}\n  description={…}\n  title={employee.name}\n  width="var(--container-detail-wide)"\n>\n  …\n</DetailDrawer>`,
			}}
			sections={[
				{ children: <Drawers />, id: "drawer", title: "抽屉：数据页与技能页" },
				{ children: <Logs />, id: "logs", title: "任务日志" },
				{ children: <Side />, id: "detail", title: "人的详情" },
			]}
		/>
	);
}
