import { type ComponentProps, useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
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
import { Text } from "#/components/ui/text";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

type TextProps = ComponentProps<typeof Text>;
type TextType = NonNullable<TextProps["type"]>;
type TextSize = NonNullable<TextProps["size"]>;
type TextWeight = NonNullable<TextProps["weight"]>;

const TYPES: [TextType, string][] = [
	["secondary", "次要"],
	["tertiary", "说明"],
	["quaternary", "占位"],
];

const SIZES: TextSize[] = ["xs", "sm", "lg", "2xl"];
const WEIGHTS: TextWeight[] = ["medium", "bold"];

const LONG =
	"负责支付风控平台的规则引擎与实时特征计算，主导了交易反欺诈模型从离线批量评分到在线毫秒级决策的迁移，覆盖日均三千万笔交易。";

function Playground() {
	const [label, setLabel] = useState(LONG);
	const [type, setType] = useState<TextType | "default">("default");
	const [size, setSize] = useState<TextSize | "inherit">("inherit");
	const [ellipsis, setEllipsis] = useState(true);
	const [tooltip, setTooltip] = useState(true);
	const [code, setCode] = useState(false);
	const [shiny, setShiny] = useState(false);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control className="grow" htmlFor="playground-text-label" label="文字">
					<Input
						id="playground-text-label"
						onChange={(event) => setLabel(event.target.value)}
						value={label}
					/>
				</Control>
				<Control label="颜色">
					<Segmented<TextType | "default">
						onChange={setType}
						options={[
							{ label: "继承", value: "default" },
							...TYPES.map(([value, label]) => ({ label, value })),
						]}
						value={type}
					/>
				</Control>
				<Control label="字号">
					<Segmented<TextSize | "inherit">
						onChange={setSize}
						options={[
							{ label: "继承", value: "inherit" },
							...SIZES.map((value) => ({ label: value, value })),
						]}
						value={size}
					/>
				</Control>
				<Control>
					<Checkbox checked={ellipsis} onChange={setEllipsis}>
						单行截断
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={tooltip} onChange={setTooltip}>
						截断时提示全文
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={code} onChange={setCode}>
						等宽
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={shiny} onChange={setShiny}>
						扫光
					</Checkbox>
				</Control>
			</Controls>
			<Stage footer={<span>拖动右下角改宽度，截断随宽度变化</span>}>
				<div className="w-80 max-w-full resize-x overflow-hidden">
					<Text
						code={code}
						ellipsis={ellipsis && tooltip ? { tooltip: true } : ellipsis}
						shiny={shiny}
						size={size === "inherit" ? undefined : size}
						type={type === "default" ? undefined : type}
					>
						{label}
					</Text>
				</div>
			</Stage>
		</div>
	);
}

function Appearances() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>写法</TableHead>
						<TableHead className="w-full">示例</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{TYPES.map(([type, label]) => (
						<TableRow key={type}>
							<TableCell className="font-mono text-xs">type="{type}"</TableCell>
							<TableCell>
								<Text type={type}>{label}：支付风控 · 三年</Text>
							</TableCell>
						</TableRow>
					))}
					{SIZES.map((size) => (
						<TableRow key={size}>
							<TableCell className="font-mono text-xs">size="{size}"</TableCell>
							<TableCell>
								<Text size={size}>后端工程师</Text>
							</TableCell>
						</TableRow>
					))}
					{WEIGHTS.map((weight) => (
						<TableRow key={weight}>
							<TableCell className="font-mono text-xs">
								weight="{weight}"
							</TableCell>
							<TableCell>
								<Text weight={weight}>后端工程师</Text>
							</TableCell>
						</TableRow>
					))}
					<TableRow>
						<TableCell className="font-mono text-xs">code</TableCell>
						<TableCell>
							<Text code type="tertiary">
								E0012345
							</Text>
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">shiny</TableCell>
						<TableCell>
							<Text shiny>正在理解需求</Text>
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">
							shiny type="secondary"
						</TableCell>
						<TableCell>
							<Text shiny type="secondary">
								正在理解需求
							</Text>
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="名单行里的部门路径放不下时截成一行，悬停看全文；没截断就没有提示。"
				title="截断与提示"
			>
				<div className="flex w-full min-w-0 flex-col gap-1">
					<Text ellipsis={{ tooltip: true }} weight="medium">
						技术中心 / 金融科技事业部 / 支付平台部 / 风控策略组 / 实时特征小组
					</Text>
					<Text ellipsis={{ tooltip: true }} type="tertiary">
						技术中心 / 支付平台部
					</Text>
				</div>
			</Example>
			<Example
				description="姓名后面的工号用等宽字体、说明色，位数对齐。"
				title="工号"
			>
				<div className="flex items-baseline gap-2">
					<Text weight="medium">陈一鸣</Text>
					<Text code size="xs" type="tertiary">
						E0012345
					</Text>
				</div>
			</Example>
			<Example
				description="AI 还在处理时那几个字扫光，静止色与旁边的次要文字一致。"
				title="进行中"
			>
				<div className="flex flex-col gap-1">
					<Text shiny size="xs" type="secondary">
						正在查人才库里的说法
					</Text>
					<Text size="xs" type="secondary">
						已找到 128 人
					</Text>
				</div>
			</Example>
		</ExampleGrid>
	);
}

export function TextPage() {
	return (
		<DocPage
			facts={[
				`${TYPES.length} 种颜色`,
				`${SIZES.length} 档字号`,
				"单行截断",
				"扫光",
			]}
			rules={{
				notes: [
					"不给 type 时颜色随外层继承；颜色只用 type 的几档，不写 text-fg-* 覆盖。",
					"字号、字重只用 size、weight 的档名，对应字阶令牌；不传像素数。",
					"截断要有宽度可比：放在 flex 里时外层给 min-w-0。",
					"ellipsis 的 tooltip 只在真被截断时出提示，不用手写 title=。",
					"shiny 只给「正在进行」的几个字；配 type 时静止色就是那一档。",
					"工号等要对齐位数的编号用 code，不另写 font-mono。",
				],
				usage: `<Text ellipsis={{ tooltip: true }}>{department}</Text>\n<Text code size="xs" type="tertiary">{empId}</Text>\n<Text shiny type="secondary">正在理解需求</Text>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用文字" },
				{ children: <Appearances />, id: "appearance", title: "写法" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
