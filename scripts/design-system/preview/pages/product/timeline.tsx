import { useState } from "react";
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
import { Dot } from "#/routes/s/$turnId/-components/evidence";
import { Timeline } from "#/routes/s/$turnId/-components/timeline";
import { countedOf } from "#/routes/s/$turnId/-lib/claim-lines";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import {
	EMPLOYEES,
	evidenceOf,
	experience,
	experiencesOf,
} from "../../samples/people";

/**
 * 节点状态表的一行：一段经历，算数或不算数。编号加一个偏移，
 * 同一页上的几条时间线不共用锚点 id。
 */
function nodeRow(hit: boolean, offset: number) {
	const base = experience(103);
	const row = { ...base, id: base.id + offset };
	return { counted: new Set(hit ? [row.id] : []), rows: [row] };
}

const NODES: [label: string, hit: boolean][] = [
	["命中", true],
	["未命中", false],
];

function Playground() {
	const [empId, setEmpId] = useState("T0101");
	const [withEvidence, setWithEvidence] = useState(true);
	const rows = experiencesOf(empId);
	const counted = countedOf(withEvidence ? evidenceOf(empId) : []);
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
					<Checkbox checked={withEvidence} onChange={setWithEvidence}>
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
						<span>命中 {counted.size} 段</span>
					</>
				}
			>
				<div className="mx-auto w-full max-w-(--container-detail)">
					<Timeline counted={counted} rows={rows} />
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
					{NODES.map(([label, hit], i) => {
						const node = nodeRow(hit, 1000 * (i + 1));
						return (
							<TableRow key={label}>
								<TableCell className="whitespace-nowrap">
									<span className="flex items-center gap-1.5 text-xs">
										<Dot found={hit} />
										{label}
									</span>
								</TableCell>
								<TableCell className="w-full">
									<div className="max-w-(--container-detail)">
										<Timeline {...node} />
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
	const hit = countedOf(evidenceOf(empId)).has(id);
	return { counted: new Set(hit ? [row.id] : []), rows: [row] };
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="入职前的段标「入职前」，序列是按岗位名推断的一对，后面注「推断」；公司档、行业、性质接在起止后面。"
				title="入职前的经历"
			>
				<div className="w-full">
					<Timeline {...single(602, "T0106", 6000)} />
				</div>
			</Example>
			<Example
				description="算不算是读过整段之后的结论：HR 读这一段的岗位和原文核对，原文不做字面高亮。"
				title="技能与原文"
			>
				<div className="w-full">
					<Timeline {...single(101, "T0101", 7000)} />
				</div>
			</Example>
			<Example
				description="公司内的段在最后一行写部门路径，和上面的简历原文隔开。"
				title="公司内的任职"
			>
				<div className="w-full">
					<Timeline {...single(202, "T0102", 8000)} />
				</div>
			</Example>
		</ExampleGrid>
	);
}

/** 经历时间线：人的详情里在职与入职前连续排的经历段，最近的在最上面。 */
export function TimelinePage() {
	return (
		<DocPage
			facts={[`${NODES.length} 种节点`, "入职前标签", "命中铺底"]}
			rules={{
				notes: [
					"节点就是证据行那颗 Dot，只说这一段命中了没有，不另画一套命中点。",
					"「入职前」用描边标签说，不靠节点的样子区分。",
					"算数的段整段铺一块填充的 Block，不写它为哪条条件算数、凭哪个字段：条件名只在条件那一排出现。",
					"不算数的段是无底的 Block，边距相同，各段的字对齐。",
					"推断序列只标「推断」，不和登记的序列混为一谈。",
					"时间线放在人的详情里：宽屏在名单旁的右栏，窄屏在详情浮层，不另开一栏。",
				],
				usage: `<Timeline counted={countedOf(evidence)} rows={timeline} />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用时间线" },
				{ children: <Nodes />, id: "appearance", title: "节点" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
