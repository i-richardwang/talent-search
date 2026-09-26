import { useState } from "react";
import { Dot } from "#/components/evidence";
import { buildHitIndex, Timeline } from "#/components/timeline";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { claimName } from "#/search/condition-label";
import type { Strength } from "#/search/evidence";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { CLAIMS } from "../../samples/conditions";
import {
	EMPLOYEES,
	experience,
	experiencesOf,
	hitOn,
	hitsOf,
} from "../../samples/people";

const NAMES = CLAIMS.map(claimName);

/**
 * 节点状态表的一行：一段经历配一条指定来源的命中。编号加一个偏移，
 * 同一页上的几条时间线不共用锚点 id。
 */
function nodeRow(strength: Strength | null, offset: number) {
	const base = strength === "claimed" ? experience(101) : experience(103);
	const row = { ...base, id: base.id + offset };
	const route =
		strength === "controlled" ? "seq" : strength === "org" ? "org" : "did";
	const hits = strength
		? [
				hitOn(row, {
					involvement: route === "did" ? "从零搭建" : null,
					phrase: route === "did" ? "实时推荐系统" : null,
					route,
					value: "推荐系统",
				}),
			]
		: [];
	return { hitIndex: buildHitIndex(hits), rows: [row] };
}

const NODES: [label: string, strength: Strength | null][] = [
	["岗位或序列", "controlled"],
	["部门或公司", "org"],
	["简历自述", "claimed"],
	["未命中", null],
];

function Playground() {
	const [empId, setEmpId] = useState("T0101");
	const [hits, setHits] = useState(true);
	const rows = experiencesOf(empId);
	const hitIndex = buildHitIndex(hits ? hitsOf(empId) : []);
	const external = rows.filter((x) => x.kind === "external").length;
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="候选人">
					<Segmented<string>
						onChange={setEmpId}
						options={EMPLOYEES.map((e) => ({
							label: e.name,
							value: e.empId,
						}))}
						value={empId}
					/>
				</Control>
				<Control>
					<Checkbox checked={hits} onChange={setHits}>
						带上本次命中
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				className="items-stretch"
				footer={
					<>
						<span>公司内 {rows.length - external} 段</span>
						<span>入职前 {external} 段</span>
						<span>命中 {hitIndex.size} 段</span>
					</>
				}
			>
				<div className="mx-auto w-full max-w-(--container-detail)">
					<Timeline hitIndex={hitIndex} names={NAMES} rows={rows} />
				</div>
			</Stage>
		</div>
	);
}

function Nodes() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>节点</TableHead>
						<TableHead>这一段</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{NODES.map(([label, strength], i) => {
						const node = nodeRow(strength, 1000 * (i + 1));
						return (
							<TableRow key={label}>
								<TableCell className="whitespace-nowrap">
									<span className="flex items-center gap-1.5 text-xs">
										<Dot strength={strength ?? undefined} />
										{label}
									</span>
								</TableCell>
								<TableCell className="w-full">
									<div className="max-w-(--container-detail)">
										<Timeline names={NAMES} {...node} />
									</div>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</Block>
	);
}

/** 使用场景里单独画一段：编号加偏移，不和试用里的锚点重名。 */
function single(id: number, empId: string, offset: number) {
	const row = { ...experience(id), id: id + offset };
	const hits = hitsOf(empId)
		.filter((h) => h.experienceId === id)
		.map((h) => ({ ...h, experienceId: row.id }));
	return { hitIndex: buildHitIndex(hits), rows: [row] };
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="一段经历同时为两条主张作证：节点画最强的那一档，下面每条主张一枚描边标签。"
				title="一段命中两条"
			>
				<div className="w-full">
					<Timeline names={NAMES} {...single(303, "T0103", 5000)} />
				</div>
			</Example>
			<Example
				description="入职前的段标「入职前」，序列是按岗位名推断的一对，后面注「推断」；公司档、行业、性质接在起止后面。"
				title="入职前的经历"
			>
				<div className="w-full">
					<Timeline names={NAMES} {...single(602, "T0106", 6000)} />
				</div>
			</Example>
			<Example
				description="抽取出的说法写进标签，HR 对着下面的简历原文就能看出凭什么算命中；原文不做字面高亮。"
				title="做过的事与原文"
			>
				<div className="w-full">
					<Timeline names={NAMES} {...single(101, "T0101", 7000)} />
				</div>
			</Example>
			<Example
				description="公司内的段在最后一行写部门路径，和上面的简历原文隔开。"
				title="公司内的任职"
			>
				<div className="w-full">
					<Timeline names={NAMES} {...single(202, "T0102", 8000)} />
				</div>
			</Example>
		</ExampleGrid>
	);
}

/** 经历时间线：人的详情里在职与入职前连续排的经历段，最近的在最上面。 */
export function TimelinePage() {
	return (
		<DocPage
			facts={[`${NODES.length} 种节点`, "入职前标签", "命中标签"]}
			rules={{
				notes: [
					"节点就是证据行那颗 Dot，说的是这一段证据最强的一档；不另画一套命中点。",
					"「入职前」用描边标签说，不占用空心节点：空心在点阵里是「简历自述」。",
					"命中标签全部描边、不按强度上色，强度只由节点表示。",
					"推断序列只标「推断」，不和登记的序列混为一谈。",
					"时间线放在人的详情里：宽屏在名单旁的右栏，窄屏在详情浮层，不另开一栏。",
				],
				usage: `<Timeline\n  hitIndex={buildHitIndex(hits)}\n  names={claims.map(claimName)}\n  rows={timeline}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用时间线" },
				{ children: <Nodes />, id: "appearance", title: "节点" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
