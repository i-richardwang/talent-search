import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import type { Experience, Route } from "#/db/schema";
import {
	CareerBar,
	packLanes,
	ym,
} from "#/routes/s/$turnId/-components/career-bar";
import { BAND_FILL } from "#/routes/s/$turnId/-components/evidence";
import {
	buildHitIndex,
	Timeline,
} from "#/routes/s/$turnId/-components/timeline";
import { claimName } from "#/search/condition-label";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { CLAIMS } from "../../samples/conditions";
import { EMPLOYEES, experiencesOf, hitOn, hitsOf } from "../../samples/people";

const NAMES = CLAIMS.map(claimName);

/** 一个人的带子要的三样：经历段、命中索引、入职日。 */
function barOf(empId: string, withHits = true) {
	const employee = EMPLOYEES.find((e) => e.empId === empId);
	return {
		hireDate: employee?.hireDate ?? null,
		hitIndex: buildHitIndex(withHits ? hitsOf(empId) : []),
		rows: experiencesOf(empId),
	};
}

/** 从一段样例经历改出一段新的：换编号和起止，月数按起止算。 */
function reshape(
	base: Experience,
	id: number,
	startDate: string,
	endDate: string | null,
): Experience {
	const end = ym(endDate ?? "2026-09-01");
	return {
		...base,
		endDate,
		id,
		contentKey: `reshape-${id}`,
		months: Math.max(end - ym(startDate), 1),
		startDate,
	};
}

const [FIRST, SECOND, THIRD] = experiencesOf("T0101") as [
	Experience,
	Experience,
	Experience,
];

/** 编码表的一行：三段经历，中间那段按给定来源命中，或都不命中。 */
function encodingRow(route: Route | null) {
	return {
		hireDate: SECOND.startDate,
		hitIndex: buildHitIndex(
			route ? [hitOn(SECOND, { route, value: "推荐系统" })] : [],
		),
		rows: [FIRST, SECOND, THIRD],
	};
}

/** 两张表里同一段时间各登记一次：带子分成两条轨，谁也不盖住谁。 */
const OVERLAP = [
	reshape(FIRST, 901, "2016-01-01", "2020-06-30"),
	reshape(SECOND, 902, "2019-03-01", "2022-12-31"),
	reshape(THIRD, 903, "2023-01-01", null),
];

const ENCODINGS: [label: string, bar: ReturnType<typeof encodingRow>][] = [
	["命中 · 岗位或序列", encodingRow("seq")],
	["命中 · 部门或公司", encodingRow("org")],
	["命中 · 简历自述", encodingRow("skill")],
	["未命中", encodingRow(null)],
	[
		"重叠的两段分两条轨",
		{
			hireDate: "2019-03-01",
			hitIndex: buildHitIndex([
				hitOn(OVERLAP[1] as Experience, { route: "title", value: "推荐系统" }),
			]),
			rows: OVERLAP,
		},
	],
];

function Playground() {
	const [empId, setEmpId] = useState("T0101");
	const [hits, setHits] = useState(true);
	const [hire, setHire] = useState(true);
	const bar = barOf(empId, hits);
	const lanes = packLanes(
		bar.rows.map((x) => ({
			end: ym(x.endDate ?? "2026-09-01"),
			start: ym(x.startDate),
		})),
	);
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
				<Control>
					<Checkbox checked={hire} onChange={setHire}>
						标出入职
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						<span>{bar.rows.length} 段经历</span>
						<span>{Math.max(...lanes) + 1} 条轨</span>
						<span>命中 {bar.hitIndex.size} 段</span>
					</>
				}
			>
				<div className="w-full max-w-(--container-detail)">
					<CareerBar
						hireDate={hire ? bar.hireDate : null}
						hitIndex={bar.hitIndex}
						rows={bar.rows}
					/>
				</div>
			</Stage>
		</div>
	);
}

function Encodings() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>这一段</TableHead>
						<TableHead>带子</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{ENCODINGS.map(([label, bar]) => (
						<TableRow key={label}>
							<TableCell className="whitespace-nowrap text-xs">
								{label}
							</TableCell>
							<TableCell className="w-full">
								<div className="max-w-(--container-detail) pt-4">
									<CareerBar {...bar} />
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	const detail = barOf("T0106");
	const reading = barOf("T0101");
	return (
		<ExampleGrid>
			<Example
				description="人的详情抬头下面一条：先看路径的形状——跨了几家、命中的那段落在哪几年。"
				title="详情里的轨迹"
			>
				<div className="w-full">
					<CareerBar {...detail} />
				</div>
			</Example>
			<Example
				description="点一个色块，下面的经历时间线滚到那一段：带子给形状，卡片给细节。"
				title="带子通往卡片"
			>
				<div className="flex w-full flex-col">
					<CareerBar {...reading} />
					<ScrollArea className="h-60 w-full">
						<Timeline
							hitIndex={reading.hitIndex}
							names={NAMES}
							rows={reading.rows}
						/>
					</ScrollArea>
				</div>
			</Example>
			<Example
				description="入职日离两端太近时只画竖线、不写「入职」，免得压住起止年份。"
				title="入职靠近一端"
			>
				<div className="w-full">
					<CareerBar
						hireDate="2024-05-20"
						hitIndex={detail.hitIndex}
						rows={detail.rows}
					/>
				</div>
			</Example>
			<Example
				description="一段经历都没有时不画，不留一条空带子。下面这一格因此是空的。"
				title="没有经历"
			>
				<CareerBar hireDate={null} hitIndex={new Map()} rows={[]} />
			</Example>
		</ExampleGrid>
	);
}

/** 职业轨迹条：一个人的经历段按真实年份画成的一条带子。 */
export function CareerBarPage() {
	return (
		<DocPage
			facts={[
				`${Object.keys(BAND_FILL).length} 档命中颜色`,
				"未命中细线",
				"重叠分轨",
			]}
			rules={{
				notes: [
					"高度说这一段命中了没有，颜色说证据有多强；颜色取自 evidence.tsx 的 BAND_FILL，和证据行同义。",
					"绿色只表示登记的岗位或序列命中；未命中的段是一道 fill 色的细条，永远不上色。",
					"段与段之间留一道缝，四角是最小的圆角；深浅两色下都看得出每一段。",
					"在职与入职前连续排，转折点只由「入职」那根竖线说明。",
					"每个色块是一个按钮，点了滚到经历时间线上对应的那一段。",
				],
				usage: `<CareerBar\n  hireDate={employee.hireDate}\n  hitIndex={buildHitIndex(hits)}\n  rows={timeline}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用轨迹条" },
				{ children: <Encodings />, id: "appearance", title: "编码" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
