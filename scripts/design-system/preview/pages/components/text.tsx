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
type TextElement = NonNullable<TextProps["as"]>;

const TYPES: [TextType, string][] = [
	["secondary", "次要"],
	["tertiary", "说明"],
	["quaternary", "占位"],
	["success", "成功"],
	["warning", "留意"],
	["danger", "错误"],
	["info", "信息"],
];

const SIZES: TextSize[] = ["xs", "sm", "base", "lg", "xl", "2xl"];
const WEIGHTS: TextWeight[] = ["normal", "medium", "semibold", "bold"];
const HEADINGS: TextElement[] = ["h1", "h2", "h3", "h4", "h5"];

const LONG =
	"负责支付风控平台的规则引擎与实时特征计算，主导了交易反欺诈模型从离线批量评分到在线毫秒级决策的迁移，覆盖日均三千万笔交易。";

type EllipsisMode = "off" | "one" | "two";

function Playground() {
	const [label, setLabel] = useState(LONG);
	const [type, setType] = useState<TextType | "default">("default");
	const [size, setSize] = useState<TextSize>("base");
	const [ellipsis, setEllipsis] = useState<EllipsisMode>("one");
	const [tooltip, setTooltip] = useState(true);
	const [strong, setStrong] = useState(false);
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
						variant="filled"
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
					<Segmented<TextSize>
						onChange={setSize}
						options={SIZES}
						value={size}
					/>
				</Control>
				<Control label="截断">
					<Segmented<EllipsisMode>
						onChange={setEllipsis}
						options={[
							{ label: "不截", value: "off" },
							{ label: "单行", value: "one" },
							{ label: "两行", value: "two" },
						]}
						value={ellipsis}
					/>
				</Control>
				<Control>
					<Checkbox checked={tooltip} onChange={setTooltip}>
						截断时提示全文
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={strong} onChange={setStrong}>
						粗体
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
						ellipsis={
							ellipsis === "off"
								? false
								: { rows: ellipsis === "two" ? 2 : 1, tooltip }
						}
						shiny={shiny}
						size={size}
						strong={strong}
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
					{HEADINGS.map((as) => (
						<TableRow key={as}>
							<TableCell className="font-mono text-xs">as="{as}"</TableCell>
							<TableCell>
								<Text as={as}>搜索条件</Text>
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
				description="一栏里的小节标题：12px 半粗、次要色，与下面的内容隔一小段。"
				title="小节标题"
			>
				<div className="flex w-full flex-col gap-2">
					<Text as="h3" size="xs" type="secondary" weight="semibold">
						工作经历
					</Text>
					<Text as="p">支付风控 · 高级工程师 · 2021 至今</Text>
				</div>
			</Example>
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
					<Text strong>陈一鸣</Text>
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

/** 文字页：试用各项、全部写法、产品里的几种用法。 */
export function TextPage() {
	return (
		<DocPage
			facts={[
				`${TYPES.length} 种颜色`,
				`${SIZES.length} 档字号`,
				"单行 / 多行截断",
				"扫光",
			]}
			rules={{
				notes: [
					"不给 type 时颜色随外层继承；颜色只用 type 的几档，不写 text-fg-* 覆盖。",
					"字号、字重只用 size、weight 的档名，对应字阶令牌；不传像素数。",
					"截断要有宽度可比：放在 flex 里时外层给 min-w-0。",
					"ellipsis 的 tooltip 只在真被截断时出提示，不再手写 title=。",
					"shiny 只给「正在进行」的几个字；配 type 时静止色就是那一档。",
					"工号等要对齐位数的编号用 code，不另写 font-mono。",
				],
				usage: `<Text as="h3" size="xs" type="secondary" weight="semibold">工作经历</Text>\n<Text ellipsis={{ tooltip: true }}>{department}</Text>\n<Text ellipsis={{ rows: 2 }}>{summary}</Text>\n<Text code size="xs" type="tertiary">{empId}</Text>\n<Text shiny type="secondary">正在理解需求</Text>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用文字" },
				{ children: <Appearances />, id: "appearance", title: "写法" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
