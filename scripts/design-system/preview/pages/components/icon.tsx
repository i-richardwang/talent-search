import {
	BadgeCheck,
	Briefcase,
	Clock,
	GraduationCap,
	Loader2,
	type LucideIcon,
	RefreshCw,
	Search,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { Icon, type IconProps } from "#/components/ui/icon";
import { Input } from "#/components/ui/input";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { px, useMeasured } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

type SizeChoice = "inherit" | "small" | "middle";
type IconSize = IconProps["size"];
type Tone = "inherit" | "secondary" | "success" | "warning";

const ICONS: Record<string, LucideIcon> = {
	briefcase: Briefcase,
	graduation: GraduationCap,
	refresh: RefreshCw,
	search: Search,
};

/** 色调对应的字色类；Icon 的字色跟着外层走。 */
const TONE_CLASS: Record<Tone, string> = {
	inherit: "text-fg",
	secondary: "text-fg-tertiary",
	success: "text-success",
	warning: "text-warning",
};

/** 表里每一行：写法、说明、size 的取值。 */
const SIZE_ROWS: [code: string, label: string, size: IconSize][] = [
	["undefined", "跟随字号（1em）", undefined],
	['"small"', "小", "small"],
	['"middle"', "中", "middle"],
	["18", "直接给像素", 18],
	['{ size: "0.95em" }', "按字号的倍数", { size: "0.95em" }],
];

/** 量容器里第一个图标渲染后的边长和线宽。 */
function measureGlyph(root: HTMLElement) {
	const svg = root.querySelector("svg");
	if (!svg) return undefined;
	return {
		size: svg.getBoundingClientRect().width,
		stroke: svg.getAttribute("stroke-width") ?? "",
	};
}

function Playground() {
	const [name, setName] = useState("search");
	const [size, setSize] = useState<SizeChoice>("middle");
	const [tone, setTone] = useState<Tone>("inherit");
	const [spin, setSpin] = useState(false);
	const { reading: measured, ref } = useMeasured(measureGlyph);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="图标">
					<Segmented
						onChange={setName}
						options={[
							{ label: "搜索", value: "search" },
							{ label: "岗位", value: "briefcase" },
							{ label: "学历", value: "graduation" },
							{ label: "刷新", value: "refresh" },
						]}
						value={name}
					/>
				</Control>
				<Control label="尺寸">
					<Segmented<SizeChoice>
						onChange={setSize}
						options={[
							{ label: "跟随字号", value: "inherit" },
							{ label: "小", value: "small" },
							{ label: "中", value: "middle" },
						]}
						value={size}
					/>
				</Control>
				<Control label="字色（外层的类）">
					<Segmented<Tone>
						onChange={setTone}
						options={[
							{ label: "正文", value: "inherit" },
							{ label: "辅助", value: "secondary" },
							{ label: "命中", value: "success" },
							{ label: "留意", value: "warning" },
						]}
						value={tone}
					/>
				</Control>
				<Control>
					<Checkbox checked={spin} onChange={setSpin}>
						旋转
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					measured && (
						<>
							<span>图标 {px(measured.size)}</span>
							<span>线宽 {measured.stroke}</span>
						</>
					)
				}
			>
				<div className={`text-2xl ${TONE_CLASS[tone]}`} ref={ref}>
					<Icon
						icon={ICONS[name] ?? Search}
						size={size === "inherit" ? undefined : size}
						spin={spin}
					/>
				</div>
			</Stage>
		</div>
	);
}

function SizeRow({
	code,
	label,
	size,
}: {
	code: string;
	label: string;
	size: IconSize;
}) {
	const { reading: measured, ref } = useMeasured(measureGlyph);
	return (
		<TableRow>
			<TableCell>
				<div className="flex flex-col gap-0.5">
					<span className="font-mono text-xs">{code}</span>
					<span className="text-fg-tertiary text-xs tabular-nums">
						{label}
						{measured && ` · ${px(measured.size)} · 线宽 ${measured.stroke}`}
					</span>
				</div>
			</TableCell>
			<TableCell>
				<div ref={ref}>
					<Icon icon={Briefcase} size={size} />
				</div>
			</TableCell>
			<TableCell>
				<span className="inline-flex items-center gap-1.5 text-sm">
					<Icon icon={GraduationCap} size={size} />
					硕士及以上
				</span>
			</TableCell>
			<TableCell>
				<span className="inline-flex items-center gap-1.5 text-fg-secondary text-xs">
					<Icon icon={Clock} size={size} />
					三天前更新
				</span>
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
						<TableHead>size</TableHead>
						<TableHead>单独</TableHead>
						<TableHead>控件字旁</TableHead>
						<TableHead>小号字旁</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{SIZE_ROWS.map(([code, label, size]) => (
						<SizeRow code={code} key={code} label={label} size={size} />
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
				description="不传 size 时图标是 1em，跟着所在那行的字号走，行内元信息不必单独配尺寸。"
				title="跟着文字"
			>
				<div className="flex flex-col gap-1.5">
					<span className="inline-flex items-center gap-1.5 text-sm">
						<Icon icon={Briefcase} />
						后端工程师 · 基础平台部
					</span>
					<span className="inline-flex items-center gap-1.5 text-fg-tertiary text-xs">
						<Icon icon={Clock} />
						简历自述 · 三天前更新
					</span>
				</div>
			</Example>
			<Example
				description="输入框的前缀与后缀插槽放 small 图标；等待建议时后缀换成旋转的加载图标。"
				title="输入框插槽"
			>
				<Input
					aria-label="经历或技能"
					placeholder="输入关键词"
					prefix={<Icon icon={Search} size="small" />}
					suffix={<Icon icon={Loader2} size="small" spin />}
				/>
			</Example>
			<Example
				description="颜色由外层的字色类给；绿表示受控字段命中，amber 表示需要留意。"
				title="状态色"
			>
				<span className="inline-flex items-center gap-1.5 text-sm text-success">
					<Icon icon={BadgeCheck} size="small" />
					岗位名命中
				</span>
				<span className="inline-flex items-center gap-1.5 text-sm text-warning">
					<Icon icon={TriangleAlert} size="small" />
					只有简历自述
				</span>
			</Example>
			<Example
				description="同步任务进行中时刷新图标旋转，完成后停下，文字说结论。"
				title="进行中"
			>
				<span className="inline-flex items-center gap-1.5 text-fg-secondary text-sm">
					<Icon icon={RefreshCw} size="small" spin />
					人才库正在同步
				</span>
			</Example>
		</ExampleGrid>
	);
}

/** 图标：两档预设尺寸、跟随字号的默认值和按像素或字号倍数给的尺寸；字色随外层。 */
export function IconPage() {
	return (
		<DocPage
			facts={[
				`${SIZE_ROWS.filter(([, , size]) => typeof size === "string").length} 种预设尺寸`,
				"跟随字号",
				"旋转",
			]}
			rules={{
				notes: [
					"组件的 icon 属性直接传图标组件，由组件按自己的尺寸画；单独放图标才用 Icon。",
					"颜色用外层的字色令牌类，不在 color 里写色值；绿表示受控字段命中，amber 表示需要留意。",
					"与文字并排时不传 size，图标跟着字号走。",
					"加载中用 spin，不另写动画。",
				],
				usage: `<Icon icon={Search} size="small" />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用图标" },
				{ children: <Sizes />, id: "sizes", title: "尺寸" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
