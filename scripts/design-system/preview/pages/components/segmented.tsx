import { LayoutGrid, List, MessageSquare, Search } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { Icon } from "#/components/ui/icon";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { COMPONENT_TIERS } from "../../../shared/tokens/registry";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { SizeCell, SizeReading } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { useTier } from "../../state";

const PERIODS = [
	{ label: "不限", value: "any" },
	{ label: "近 1 年", value: "1y" },
	{ label: "近 3 年", value: "3y" },
	{ label: "近 5 年", value: "5y" },
];

type SegmentedSize = NonNullable<ComponentProps<typeof Segmented>["size"]>;

const VIEWS = [
	{ icon: <Icon icon={List} />, title: "列表", value: "list" },
	{ icon: <Icon icon={LayoutGrid} />, title: "卡片", value: "card" },
];

/** 外观表的行：选中的是哪一项。 */
const LOOKS: [name: string, period: string, view: string][] = [
	["选中第一项", "any", "list"],
	["选中后面的项", "3y", "card"],
];

/** 自己持有选中项的示例。 */
function Sample({
	initial,
	...props
}: Omit<ComponentProps<typeof Segmented>, "onChange" | "value"> & {
	initial: string;
}) {
	const [value, setValue] = useState(initial);
	return <Segmented {...props} onChange={setValue} value={value} />;
}

function Playground() {
	const size = useTier("segmented");
	const [value, setValue] = useState("3y");
	const [block, setBlock] = useState(false);
	const picked = PERIODS.find((option) => option.value === value);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={block} onChange={setBlock}>
						撑满宽度
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				className={block ? "items-stretch" : undefined}
				footer={
					<>
						<span className="font-mono">{size}</span>
						<SizeReading group="segmented" tier={size} />
						<span>当前：{picked?.label}</span>
					</>
				}
			>
				<Segmented
					aria-label="经历时间"
					block={block}
					onChange={setValue}
					options={PERIODS}
					size={size}
					value={value}
				/>
			</Stage>
		</div>
	);
}

function Appearances() {
	const size = useTier("segmented");
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>外观</TableHead>
						<TableHead>文字</TableHead>
						<TableHead>只有图标</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{LOOKS.map(([name, period, view]) => (
						<TableRow key={name}>
							<TableCell className="text-xs">{name}</TableCell>
							<TableCell>
								<Sample
									aria-label="经历时间"
									initial={period}
									options={PERIODS}
									size={size}
								/>
							</TableCell>
							<TableCell>
								<Sample
									aria-label="名单视图"
									initial={view}
									options={VIEWS}
									size={size}
								/>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function SizeRow({ size }: { size: SegmentedSize }) {
	const current = useTier("segmented");
	return (
		<TableRow data-state={size === current ? "selected" : undefined}>
			<TableCell>
				<SizeCell group="segmented" tier={size} />
			</TableCell>
			<TableCell>
				<Sample
					aria-label="经历时间"
					initial="3y"
					options={PERIODS}
					size={size}
				/>
			</TableCell>
			<TableCell>
				<Sample
					aria-label="名单视图"
					initial="list"
					options={VIEWS}
					size={size}
				/>
			</TableCell>
		</TableRow>
	);
}

function Sizes() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>尺寸</TableHead>
						<TableHead>文字</TableHead>
						<TableHead>只有图标</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{COMPONENT_TIERS.segmented.map((size) => (
						<SizeRow key={size} size={size} />
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	const [mode, setMode] = useState("ai");
	const [view, setView] = useState("list");
	const [scope, setScope] = useState("all");
	return (
		<ExampleGrid>
			<Example
				description="两种搜索方式互斥，选中哪一种就开始哪一种搜索。"
				title="切换搜索方式"
			>
				<Segmented
					aria-label="搜索方式"
					onChange={setMode}
					options={[
						{
							icon: <Icon icon={MessageSquare} />,
							label: "AI 搜索",
							value: "ai",
						},
						{
							icon: <Icon icon={Search} />,
							label: "关键词搜索",
							value: "keyword",
						},
					]}
					value={mode}
				/>
			</Example>
			<Example
				description="只有图标时每一项给 title，悬停和读屏都说得出是哪种视图。"
				title="只有图标"
			>
				<Segmented
					aria-label="名单视图"
					onChange={setView}
					options={VIEWS}
					size="small"
					value={view}
				/>
			</Example>
			<Example description="放在窄栏里时撑满宽度，各段等分。" title="撑满宽度">
				<div className="w-full">
					<Segmented
						aria-label="证据范围"
						block
						onChange={setScope}
						options={[
							{ label: "全部证据", value: "all" },
							{ label: "登记", value: "record" },
							{ label: "简历自述", value: "self" },
						]}
						value={scope}
					/>
				</div>
			</Example>
		</ExampleGrid>
	);
}

/** 分段控制器页：试用、外观与状态、尺寸、使用场景。 */
export function SegmentedPage() {
	const size = useTier("segmented");
	return (
		<DocPage
			facts={[
				`${COMPONENT_TIERS.segmented.length} 种尺寸`,
				"选中哪一段由调用处持有",
				"撑满宽度",
			]}
			rules={{
				notes: [
					"两到五个互斥的选项、切换后立刻生效时用 Segmented；要提交的单选用 Radio。",
					"一组选项用 aria-label 起名字；只有图标的项给 title。",
					"尺寸用 size，不覆盖选项的高度、圆角和内边距；宽度属于外层布局，要撑满用 block。",
					"选中的底块自己滑动，不另加选中装饰。",
				],
				usage: `<Segmented\n  aria-label="搜索方式"\n  onChange={setMode}\n  options={[\n    { label: "AI 搜索", value: "ai" },\n    { label: "关键词搜索", value: "keyword" },\n  ]}\n  value={mode}\n/>`,
			}}
			sections={[
				{
					children: <Playground />,
					id: "playground",
					tag: size,
					title: "试用分段控制器",
				},
				{
					children: <Appearances />,
					id: "appearance",
					tag: size,
					title: "外观与状态",
				},
				{ children: <Sizes />, id: "sizes", title: "尺寸" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
