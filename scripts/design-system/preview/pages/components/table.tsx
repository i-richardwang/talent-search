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
	TableSkeletonRows,
} from "#/components/ui/table";
import { Tag } from "#/components/ui/tag";
import { TextLink } from "#/components/ui/text-link";
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
	{ id: "1012", org: "搜索技术部", skill: "检索排序", years: 5 },
	{ id: "1345", org: "安全平台部", skill: "风控策略", years: 2 },
	{ id: "1678", org: "商业化部", skill: "广告投放", years: 7 },
];

type Person = (typeof PEOPLE)[number];

const COLUMNS = 4;

function PeopleHeader() {
	return (
		<TableHeader>
			<TableRow>
				<TableHead>候选人</TableHead>
				<TableHead>部门</TableHead>
				<TableHead>技能</TableHead>
				<TableHead className="text-end">累计年限</TableHead>
			</TableRow>
		</TableHeader>
	);
}

/**
 * 一行候选人。给了 `onOpen` 就整行可点，名字那格是一个真链接，
 * 行在 Tab 序里，链接不单独占 Tab 位。
 */
function PeopleRow({
	onOpen,
	person,
	selected,
}: {
	onOpen?: (id: string) => void;
	person: Person;
	selected?: boolean;
}) {
	const open = onOpen && (() => onOpen(person.id));
	return (
		<TableRow data-state={selected ? "selected" : undefined} onActivate={open}>
			<TableCell cellSlot="title" className="whitespace-nowrap">
				{open ? (
					<TextLink
						href={`#person-${person.id}`}
						onClick={(event) => {
							event.preventDefault();
							open();
						}}
						tabIndex={-1}
					>
						Talent {person.id}
					</TextLink>
				) : (
					`Talent ${person.id}`
				)}
			</TableCell>
			<TableCell cellLabel="部门" className="text-fg-secondary">
				{person.org}
			</TableCell>
			<TableCell cellLabel="技能">
				<Tag size="small">{person.skill}</Tag>
			</TableCell>
			<TableCell
				cellLabel="累计年限"
				className="whitespace-nowrap text-end tabular-nums"
			>
				{person.years} 年
			</TableCell>
		</TableRow>
	);
}

function PeopleBody({
	count = 3,
	current,
	loading,
	onOpen,
}: {
	count?: number;
	current?: string;
	loading?: boolean;
	onOpen?: (id: string) => void;
}) {
	return (
		<TableBody>
			{loading ? (
				<TableSkeletonRows columns={COLUMNS} />
			) : (
				PEOPLE.slice(0, count).map((person) => (
					<PeopleRow
						key={person.id}
						onOpen={onOpen}
						person={person}
						selected={person.id === current}
					/>
				))
			)}
		</TableBody>
	);
}

function Playground() {
	const sizeTier = useTier("table");
	const [footer, setFooter] = useState(true);
	const [clickable, setClickable] = useState(true);
	const [loading, setLoading] = useState(false);
	const [sticky, setSticky] = useState(false);
	const [empty, setEmpty] = useState(false);
	const [current, setCurrent] = useState<string | undefined>("0123");
	const count = sticky ? PEOPLE.length : 3;
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={footer} onChange={setFooter}>
						表脚
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={clickable} onChange={setClickable}>
						整行可点
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={sticky} onChange={setSticky}>
						钉住表头
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={loading} onChange={setLoading}>
						加载中
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
						<span>{empty ? "0" : count} 人</span>
						<span>正在看：{current ? `Talent ${current}` : "无"}</span>
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
							busy={loading}
							className={sticky ? "max-h-56" : undefined}
							footer={footer ? `共 ${count} 人，按匹配程度排序` : undefined}
							size={sizeTier}
							stickyHeader={sticky}
						>
							<PeopleHeader />
							<PeopleBody
								count={count}
								current={current}
								loading={loading}
								onOpen={clickable ? setCurrent : undefined}
							/>
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
					<TableRow onActivate={() => {}}>
						<TableCell className="font-mono text-xs" cellSlot="title">
							clickable
						</TableCell>
						<TableCell className="font-mono text-fg-secondary text-xs">
							onActivate=&#123;…&#125;
						</TableCell>
						<TableCell>
							整行可点：指针变手形，悬停时标题格换成链接色；Tab
							到这一行出内侧焦点框，回车、空格打开。
						</TableCell>
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

/** 加载中：表头和外框照常，表体是几行占位，外层带 aria-busy。 */
function Loading() {
	const sizeTier = useTier("table");
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table busy size={sizeTier}>
				<PeopleHeader />
				<PeopleBody loading />
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
					<PeopleBody count={2} />
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

/** 窄宽：同一张表放进不到 600px 宽的盒子，每行排成一张卡片。 */
function NarrowCards() {
	const sizeTier = useTier("table");
	const [current, setCurrent] = useState("0456");
	return (
		<div className="flex flex-wrap items-start gap-5">
			<Block className="w-full max-w-96 overflow-hidden" variant="outlined">
				<Table narrow="cards" size={sizeTier}>
					<PeopleHeader />
					<PeopleBody current={current} onOpen={setCurrent} />
				</Table>
			</Block>
			<Block className="w-full max-w-96 overflow-hidden" variant="outlined">
				<Table busy narrow="cards" size={sizeTier}>
					<PeopleHeader />
					<PeopleBody loading />
				</Table>
			</Block>
		</div>
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
						<TableHead className="text-end">用时</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{runs.map(([task, state, time]) => (
						<TableRow key={task}>
							<TableCell>{task}</TableCell>
							<TableCell>{state}</TableCell>
							<TableCell className="text-end tabular-nums">{time}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

/** 名单：整行点开详情，正在看的那一行选中。 */
function PeopleList() {
	const [current, setCurrent] = useState("0123");
	return (
		<Block className="w-full overflow-hidden" variant="outlined">
			<Table size="middle">
				<PeopleHeader />
				<PeopleBody current={current} onOpen={setCurrent} />
			</Table>
		</Block>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="整行点开详情；名字那格是真链接，中键、右键照常。正在看的那一行选中。"
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

/** 表格页：试用、行的状态、加载中、尺寸、窄宽卡片、使用场景。 */
export function TablePage() {
	const sizeTier = useTier("table");
	return (
		<DocPage
			facts={[
				`${COMPONENT_TIERS.table.length} 种尺寸`,
				"选中行",
				"整行可点",
				"钉住表头",
				"加载占位",
				"窄宽卡片",
				"表脚",
			]}
			rules={{
				notes: [
					"表用 Table，放在一块描边的 Block 里，表脚在表下；圆角和外框归那块面。",
					"表里不画线：表头是一条浅底，表体行间没有线，悬停出底；管理页的表用 small 档。",
					"空表用 Empty，说明当前问题和可执行的出路。",
					'通往详情的是整行：TableRow 的 onActivate。名字那格标 cellSlot="title"，里面仍是一个真链接（tabIndex -1），中键、右键、新标签页照常。',
					"格里的按钮、链接、勾选框点下去归它们自己，不会触发整行。",
					"加载中保留表头和外框，表体放 TableSkeletonRows，Table 带 busy。",
					'narrow="cards" 的表在不到 600px 宽时每行排成卡片；除标题格外每格写 cellLabel。',
					"短列（名字、数、日期）不折行，留一列长文字吃掉剩下的宽度（w-full）。",
					"选中行用 TableRow 的 data-state，不加勾选列或额外的选中装饰。",
					"列表不静默截断：表脚写已显示数、总数、排序和加载上限。",
				],
				usage: `<Block className="overflow-hidden" variant="outlined">\n  <Table footer="共 3 人，按匹配程度排序" narrow="cards" size="small">\n    <TableHeader>\n      <TableRow>\n        <TableHead>候选人</TableHead>\n        <TableHead>部门</TableHead>\n      </TableRow>\n    </TableHeader>\n    <TableBody>\n      <TableRow data-state="selected" onActivate={open}>\n        <TableCell cellSlot="title">\n          <TextLink render={<Link {...detail} />} tabIndex={-1}>Talent 0123</TextLink>\n        </TableCell>\n        <TableCell cellLabel="部门">数据平台部</TableCell>\n      </TableRow>\n    </TableBody>\n  </Table>\n</Block>`,
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
				{
					children: <Loading />,
					id: "loading",
					tag: sizeTier,
					title: "加载中",
				},
				{ children: <Sizes />, id: "sizes", title: "尺寸" },
				{
					children: <NarrowCards />,
					id: "narrow",
					tag: sizeTier,
					title: "窄宽卡片",
				},
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
