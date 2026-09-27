import { useEffect, useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { PickDock } from "#/routes/s/$turnId/-components/pick-dock";
import { ResultList } from "#/routes/s/$turnId/-components/result-list";
import { usePicks } from "#/routes/s/$turnId/-lib/picks";
import { claimName } from "#/search/condition-label";
import type { SearchOutcome } from "#/search/result";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { Routed } from "../../routed";
import { CLAIMS, SPEC } from "../../samples/conditions";
import { firstOf, OUTCOME, OVER_LIMIT } from "../../samples/people";
import { LATEST_TURN_ID } from "../../samples/thread";

const NAMES = CLAIMS.map(claimName);

function Playground() {
	const [narrowed, setNarrowed] = useState(false);
	const [over, setOver] = useState(false);
	const [growing, setGrowing] = useState(false);
	const outcome = firstOf(
		OUTCOME,
		narrowed ? 3 : OUTCOME.results.length,
		over ? OVER_LIMIT : OUTCOME.total,
	);
	// 选中状态跟着这次搜索（turnId 不变）：改筛选后被筛掉的人仍在已选里
	const picks = usePicks(LATEST_TURN_ID, outcome);
	const noop = () => {};
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={narrowed} onChange={setNarrowed}>
						改了筛选，只剩前三人
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={over} onChange={setOver}>
						符合条件的人超过显示上限
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				className="items-stretch p-4"
				footer={
					<span>
						{picks.picked.size > 0
							? `已选 ${picks.picked.size} 人，名单上勾着 ${picks.shownPicked.length} 人`
							: "勾名单左边的框开始挑人"}
					</span>
				}
			>
				<div className="mx-auto w-full max-w-(--container-page)">
					<Routed url={`/s/${LATEST_TURN_ID}`}>
						<ResultList
							canMore={false}
							empId={undefined}
							growing={growing}
							loading={false}
							mode="conversation"
							onAll={() => {
								picks.pickAll(false);
								setGrowing(true);
								window.setTimeout(() => setGrowing(false), 1200);
							}}
							onChange={noop}
							onEditQuery={noop}
							onMore={noop}
							onReviseQuery={noop}
							outcome={outcome}
							phase="searching"
							picks={picks}
							spec={SPEC}
							turnId={LATEST_TURN_ID}
						/>
					</Routed>
				</div>
			</Stage>
		</div>
	);
}

/** 挑选与导出的每一步。 */
const STEPS: [step: string, does: string, answers: string][] = [
	[
		"勾人",
		"点名单左边的选择框，表头那一个全选；或者 ↑↓ 走到一个人，按空格",
		"选了第一个人，名单下沿浮出操作栏；一个都没选时它不出现",
	],
	[
		"看已选的人",
		"点操作栏上的「已选 N 人」",
		"弹层按名次列出已选的人，每行可以移除；改过筛选后不在名单上的人标出来",
	],
	[
		"清空",
		"点「清空」",
		"已选的人全部清掉；换一次搜索时也清空，不带到别的名单上",
	],
	[
		"导出",
		"点「导出 N 人」",
		"对话框列出表格的列，决定要不要带上每条条件的匹配证据",
	],
	[
		"补齐",
		"已选的比符合条件的少",
		"对话框里一块提示说清这份表是谁，给一个「选择全部」把人补齐",
	],
	["下载", "点「下载」", "浏览器存下一份 CSV，行按名次排，第一列是序号"],
];

function Flow() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>步骤</TableHead>
						<TableHead>用户做什么</TableHead>
						<TableHead>界面怎么回应</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{STEPS.map(([step, does, answers]) => (
						<TableRow key={step}>
							<TableCell className="whitespace-nowrap font-medium">
								{step}
							</TableCell>
							<TableCell className="text-fg-secondary">{does}</TableCell>
							<TableCell>{answers}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

/**
 * 单独一条操作栏：挂上时先选好前 `count` 个人。`outcome` 是名单此刻的样子，
 * 选的是完整名单上的人，所以名单变短之后多出来的那几位就不在名单上了。
 */
function Dock({
	count,
	outcome = OUTCOME,
	total = OUTCOME.total,
}: {
	count: number;
	outcome?: SearchOutcome;
	total?: number;
}) {
	const [shown, setShown] = useState(OUTCOME);
	const picks = usePicks(LATEST_TURN_ID, shown);
	const { setShown: pick } = picks;
	useEffect(() => {
		pick(OUTCOME.results.slice(0, count).map((r) => r.employee.empId));
		setShown(outcome);
	}, [count, outcome, pick]);
	return (
		<div className="flex w-full justify-center">
			<PickDock
				loading={false}
				names={NAMES}
				onAll={() => picks.pickAll(false)}
				picks={picks}
				total={total}
			/>
		</div>
	);
}

/** 挂上时就要用的两份名单，放在模块里，引用不变，挂上后只选一次。 */
const NARROWED = firstOf(OUTCOME, 3);

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="选了几个人时的操作栏：数字本身是入口，点开能看是谁、逐个移除。点导出，对话框说清这份表只是选中的这些人，并给出「选择全部」。"
				title="选了两个人"
			>
				<Dock count={2} />
			</Example>
			<Example
				description="改筛选后，先前选的人不会从已选里消失。点开「已选」能看到哪几位不在当前名单上，也只能在这里移除他们。"
				title="有人不在名单上"
			>
				<Dock count={5} outcome={NARROWED} />
			</Example>
			<Example
				description="选中的就是全部符合条件的人：点导出，对话框里没有补齐的提示，只剩列和证据的选择。"
				title="全部选中"
			>
				<Dock count={OUTCOME.results.length} />
			</Example>
			<Example
				description="符合条件的人超过显示上限时，提示里说明只能显示匹配度最高的那一段，「选择全部」选的是能显示的人。"
				title="超过显示上限"
			>
				<Dock count={2} total={OVER_LIMIT} />
			</Example>
		</ExampleGrid>
	);
}

/** 挑选与导出：在名单上勾人，操作栏汇总，导出成一份 CSV。 */
export function PickingPage() {
	return (
		<DocPage
			facts={[`${STEPS.length} 个步骤`, "选择非空才出现", "导出对话框"]}
			rules={{
				notes: [
					"批量操作用选择非空时才出现的 Toolbar；一个都没选时不渲染。",
					"已选的人是选中那一刻的快照：改筛选不会让人从已选里消失，换一次搜索或点「清空」才清空。",
					"已选的人按名次排，导出的表同序；名次写成一列，名单上不另画分数。",
					"选择状态只在内存里，不写进地址。",
					"导出中间隔一层对话框：先看清有哪些列、带不带匹配证据，以及这份表是不是全部符合条件的人。",
				],
				usage: `const picks = usePicks(turnId, outcome);\n\n<PickDock\n  loading={growing}\n  names={outcome.claims.map(claimName)}\n  onAll={pickAll}\n  picks={picks}\n  total={outcome.total}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用挑选" },
				{ children: <Flow />, id: "flow", title: "流程" },
				{ children: <Usage />, id: "usage", title: "操作栏的几种情形" },
			]}
		/>
	);
}
