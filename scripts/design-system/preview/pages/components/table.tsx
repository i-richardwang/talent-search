import { SearchX } from "lucide-react";
import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Empty } from "#/components/ui/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Tag } from "#/components/ui/tag";
import {
	COMPONENT_TIERS,
	type SizeTier,
} from "../../../shared/tokens/registry";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { SizeCell, SizeReading } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { useTier } from "../../state";

/** 合成的候选人名单。 */
const PEOPLE = [
	{ id: "0123", org: "数据平台部", skill: "推荐系统", years: 6 },
	{ id: "0456", org: "基础架构部", skill: "Kubernetes", years: 4.5 },
	{ id: "0789", org: "增长产品部", skill: "用户增长", years: 3 },
];

function PeopleHeader() {
	return (
		<TableHeader>
			<TableRow>
				<TableHead>候选人</TableHead>
				<TableHead>部门</TableHead>
				<TableHead>技能</TableHead>
				<TableHead className="text-right">累计年限</TableHead>
			</TableRow>
		</TableHeader>
	);
}

function PeopleRow({
	person,
	selected,
}: {
	person: (typeof PEOPLE)[number];
	selected?: boolean;
}) {
	return (
		<TableRow data-state={selected ? "selected" : undefined}>
			<TableCell>Talent {person.id}</TableCell>
			<TableCell className="text-fg-secondary">{person.org}</TableCell>
			<TableCell>
				<Tag size="small">{person.skill}</Tag>
			</TableCell>
			<TableCell className="text-right tabular-nums">
				{person.years} 年
			</TableCell>
		</TableRow>
	);
}

function Playground() {
	const sizeTier = useTier("table");
	const [footer, setFooter] = useState(true);
	const [selected, setSelected] = useState(true);
	const [empty, setEmpty] = useState(false);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={footer} onChange={setFooter}>
						表脚
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={selected} onChange={setSelected}>
						选中第一行
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={empty} onChange={setEmpty}>
						没有结果
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				className="items-stretch"
				footer={
					<>
						<SizeReading group="table" tier={sizeTier} />
						<span>{empty ? "0" : PEOPLE.length} 人</span>
					</>
				}
			>
				<Block className="overflow-hidden" variant="outlined">
					{empty ? (
						<Empty
							description="去掉一条搜索条件，或换一个说法再搜。"
							icon={SearchX}
							title="人才库里没有同时满足这些条件的人"
						/>
					) : (
						<Table
							footer={
								footer ? `共 ${PEOPLE.length} 人，按匹配程度排序` : undefined
							}
							size={sizeTier}
						>
							<PeopleHeader />
							<TableBody>
								{PEOPLE.map((person, index) => (
									<PeopleRow
										key={person.id}
										person={person}
										selected={selected && index === 0}
									/>
								))}
							</TableBody>
						</Table>
					)}
				</Block>
			</Stage>
		</div>
	);
}

/** 行的状态就用一张表来演示：每一行本身就是那种状态。 */
function Appearances() {
	const sizeTier = useTier("table");
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table
				footer="表脚：和表同一块面，写已显示数、总数与排序。"
				size={sizeTier}
			>
				<TableHeader>
					<TableRow>
						<TableHead>状态</TableHead>
						<TableHead>写法</TableHead>
						<TableHead>说明</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell className="font-mono text-xs">default</TableCell>
						<TableCell className="font-mono text-fg-secondary text-xs">
							&lt;TableRow&gt;
						</TableCell>
						<TableCell>常态行；指针移上来时整行换底色。</TableCell>
					</TableRow>
					<TableRow data-state="selected">
						<TableCell className="font-mono text-xs">selected</TableCell>
						<TableCell className="font-mono text-fg-secondary text-xs">
							data-state="selected"
						</TableCell>
						<TableCell>正在看的那一行，用主色一侧的底。</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">footer</TableCell>
						<TableCell className="font-mono text-fg-secondary text-xs">
							footer=&#123;…&#125;
						</TableCell>
						<TableCell>表下的一条，见本表底部。</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</Block>
	);
}

/** 一档的示例表：表头写档名与内边距读数，右栏选中的那一档用 Block 的选中态。 */
function SizeBlock({ size }: { size: SizeTier }) {
	const sizeTier = useTier("table");
	return (
		<div className="flex flex-col gap-2">
			<SizeCell group="table" tier={size} />
			<Block
				className="overflow-hidden"
				selected={size === sizeTier}
				variant="outlined"
			>
				<Table size={size}>
					<PeopleHeader />
					<TableBody>
						{PEOPLE.slice(0, 2).map((person) => (
							<PeopleRow key={person.id} person={person} />
						))}
					</TableBody>
				</Table>
			</Block>
		</div>
	);
}

function Sizes() {
	return (
		<div className="flex flex-col gap-5">
			{COMPONENT_TIERS.table.map((size) => (
				<SizeBlock key={size} size={size} />
			))}
		</div>
	);
}

/** 名单：点单元格里的文字链接看详情，正在看的那一行选中。 */
function PeopleList() {
	const [current, setCurrent] = useState("0123");
	return (
		<Block className="w-full overflow-hidden" variant="outlined">
			<Table size="middle">
				<TableHeader>
					<TableRow>
						<TableHead>候选人</TableHead>
						<TableHead className="text-right">累计年限</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{PEOPLE.map((person) => (
						<TableRow
							data-state={person.id === current ? "selected" : undefined}
							key={person.id}
						>
							<TableCell>
								<a
									className="text-fg underline-offset-4 hover:underline"
									href={`#person-${person.id}`}
									onClick={(event) => {
										event.preventDefault();
										setCurrent(person.id);
									}}
								>
									Talent {person.id}
								</a>
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{person.years} 年
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

/** 管理页的表：翻页在表脚，计数说的是整张表。 */
function TaskTable() {
	const [page, setPage] = useState(1);
	const runs = [
		["同步", "成功", "12 秒"],
		["派生", "成功", "4 分 10 秒"],
		["整理", "等待中", "—"],
	];
	return (
		<Block className="w-full overflow-hidden" variant="outlined">
			<Table
				footer={
					<div className="flex items-center justify-between gap-3">
						<span className="text-fg-tertiary text-xs tabular-nums">
							第 {page} / 3 页，共 9 次运行
						</span>
						<div className="flex gap-1">
							<Button
								disabled={page === 1}
								onClick={() => setPage(page - 1)}
								size="small"
							>
								上一页
							</Button>
							<Button
								disabled={page === 3}
								onClick={() => setPage(page + 1)}
								size="small"
							>
								下一页
							</Button>
						</div>
					</div>
				}
				size="small"
			>
				<TableHeader>
					<TableRow>
						<TableHead>任务</TableHead>
						<TableHead>结果</TableHead>
						<TableHead className="text-right">用时</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{runs.map(([task, state, time]) => (
						<TableRow key={task}>
							<TableCell>{task}</TableCell>
							<TableCell>{state}</TableCell>
							<TableCell className="text-right tabular-nums">{time}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="通往详情的是单元格里的文字链接，不在整行铺覆盖层；正在看的那一行选中。"
				title="候选人名单"
			>
				<PeopleList />
			</Example>
			<Example
				description="管理页的表在服务端翻页，表脚写第几页和整张表的总数。"
				title="运行记录"
			>
				<TaskTable />
			</Example>
			<Example
				description="没有结果时不画空表，换成 Empty，说清问题和出路。"
				title="空表"
			>
				<Block className="w-full" variant="outlined">
					<Empty
						description="换一个技能词再搜。"
						icon={SearchX}
						title="没有找到用过这个技能的人"
					/>
				</Block>
			</Example>
		</ExampleGrid>
	);
}

/** 表格页：试用、行的状态、尺寸、使用场景。 */
export function TablePage() {
	const sizeTier = useTier("table");
	return (
		<DocPage
			facts={[`${COMPONENT_TIERS.table.length} 种尺寸`, "选中行", "表脚"]}
			rules={{
				notes: [
					"表用 Table，放在一块描边的 Block 里，表脚在表下。",
					"空表用 Empty，说明当前问题和可执行的出路。",
					"通往详情的是单元格里的文字链接；不铺覆盖层，也不改单元格内边距。",
					"选中行用 TableRow 的 data-state，不加勾选列或额外的选中装饰。",
					"列表不静默截断：表脚写已显示数、总数、排序和加载上限。",
				],
				usage: `<Block className="overflow-hidden" variant="outlined">\n  <Table footer="共 3 人，按匹配程度排序">\n    <TableHeader>\n      <TableRow>\n        <TableHead>候选人</TableHead>\n      </TableRow>\n    </TableHeader>\n    <TableBody>\n      <TableRow data-state="selected">\n        <TableCell>Talent 0123</TableCell>\n      </TableRow>\n    </TableBody>\n  </Table>\n</Block>`,
			}}
			sections={[
				{
					children: <Playground />,
					id: "playground",
					tag: sizeTier,
					title: "试用表格",
				},
				{
					children: <Appearances />,
					id: "appearance",
					tag: sizeTier,
					title: "行的状态",
				},
				{ children: <Sizes />, id: "sizes", title: "尺寸" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
