import { CircleCheck, CircleDashed, TriangleAlert } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
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
import { Tag } from "#/components/ui/tag";
import { COMPONENT_TIERS } from "../../../shared/tokens/registry";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { SizeCell, SizeReading } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { useTier } from "../../state";

type TagProps = ComponentProps<typeof Tag>;
type TagVariant = NonNullable<TagProps["variant"]>;
type TagSize = NonNullable<TagProps["size"]>;
type TagColor = NonNullable<TagProps["color"]>;
type TagShape = NonNullable<TagProps["shape"]>;
type ColorChoice = TagColor | "none";

const VARIANTS: TagVariant[] = ["filled", "outlined", "borderless", "solid"];

/** 状态色表的行：状态、示例文字。processing 与 info 同色，表里只列 info。 */
const COLORS: [color: TagColor, label: string][] = [
	["success", "已完成"],
	["warning", "需留意"],
	["error", "失败"],
	["info", "进行中"],
];

function Playground() {
	const [label, setLabel] = useState("支付风控");
	const [variant, setVariant] = useState<TagVariant>("filled");
	const [color, setColor] = useState<ColorChoice>("none");
	const [shape, setShape] = useState<TagShape>("normal");
	const [withIcon, setWithIcon] = useState(false);
	const [closable, setClosable] = useState(false);
	// 关闭钮只调 onClose，由这里把标签移走。
	const [closed, setClosed] = useState(false);
	const size = useTier("tag");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control
					className="grow"
					htmlFor="playground-tag-label"
					label="标签文字"
				>
					<Input
						id="playground-tag-label"
						onChange={(event) => setLabel(event.target.value)}
						value={label}
						variant="filled"
					/>
				</Control>
				<Control label="外观">
					<Segmented<TagVariant>
						onChange={setVariant}
						options={[
							{ label: "填充", value: "filled" },
							{ label: "描边", value: "outlined" },
							{ label: "无边框", value: "borderless" },
							{ label: "实心", value: "solid" },
						]}
						value={variant}
					/>
				</Control>
				<Control label="颜色">
					<Segmented<ColorChoice>
						onChange={setColor}
						options={[
							{ label: "默认", value: "none" },
							{ label: "成功", value: "success" },
							{ label: "警告", value: "warning" },
							{ label: "错误", value: "error" },
							{ label: "信息", value: "info" },
						]}
						value={color}
					/>
				</Control>
				<Control label="形状">
					<Segmented<TagShape>
						onChange={setShape}
						options={[
							{ label: "方角", value: "normal" },
							{ label: "圆形", value: "round" },
						]}
						value={shape}
					/>
				</Control>
				<Control>
					<Checkbox checked={withIcon} onChange={setWithIcon}>
						图标
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={closable} onChange={setClosable}>
						可关闭
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						<span className="font-mono">{size}</span>
						<SizeReading group="tag" tier={size} />
					</>
				}
			>
				{closed ? (
					<Button onClick={() => setClosed(false)} size="small" type="text">
						恢复标签
					</Button>
				) : (
					<Tag
						closable={closable}
						color={color === "none" ? undefined : color}
						icon={withIcon ? CircleCheck : undefined}
						onClose={() => setClosed(true)}
						shape={shape}
						size={size}
						variant={variant}
					>
						{label}
					</Tag>
				)}
			</Stage>
		</div>
	);
}

function Appearances() {
	const size = useTier("tag");
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>外观</TableHead>
						<TableHead>文字</TableHead>
						<TableHead>可关闭</TableHead>
						{COLORS.map(([color]) => (
							<TableHead key={color}>{color}</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{VARIANTS.map((variant) => (
						<TableRow key={variant}>
							<TableCell className="font-mono text-xs">{variant}</TableCell>
							<TableCell>
								<Tag size={size} variant={variant}>
									后端
								</Tag>
							</TableCell>
							<TableCell>
								<Tag closable size={size} variant={variant}>
									支付风控
								</Tag>
							</TableCell>
							{COLORS.map(([color, label]) => (
								<TableCell key={color}>
									<Tag color={color} size={size} variant={variant}>
										{label}
									</Tag>
								</TableCell>
							))}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function SizeRow({ size }: { size: TagSize }) {
	const current = useTier("tag");
	return (
		<TableRow data-state={size === current ? "selected" : undefined}>
			<TableCell>
				<SizeCell group="tag" tier={size} />
			</TableCell>
			<TableCell>
				<Tag size={size}>后端</Tag>
			</TableCell>
			<TableCell>
				<Tag closable size={size}>
					支付风控
				</Tag>
			</TableCell>
			<TableCell>
				<Tag size={size} variant="outlined">
					入职前
				</Tag>
			</TableCell>
			<TableCell>
				<Tag color="success" icon={CircleCheck} shape="round" size={size}>
					已完成
				</Tag>
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
						<TableHead>填充</TableHead>
						<TableHead>可关闭</TableHead>
						<TableHead>描边</TableHead>
						<TableHead>圆形带图标</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{COMPONENT_TIERS.tag.map((size) => (
						<SizeRow key={size} size={size} />
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	const [terms, setTerms] = useState(["支付风控", "规则引擎", "Go"]);
	return (
		<ExampleGrid>
			<Example
				description="关键词搜索里填进来的词，每个可以单独移除；读屏会读出「移除 支付风控」。"
				title="已填的关键词"
			>
				{terms.map((term) => (
					<Tag
						closable
						key={term}
						onClose={() => setTerms(terms.filter((one) => one !== term))}
					>
						{term}
					</Tag>
				))}
				{terms.length === 0 && (
					<Button
						onClick={() => setTerms(["支付风控", "规则引擎", "Go"])}
						size="small"
						type="text"
					>
						恢复示例
					</Button>
				)}
			</Example>
			<Example
				description="经历上的附注用小号描边，不抢正文；同一张卡片里的标签只用一种外观。"
				title="经历附注"
			>
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
					<span className="font-semibold text-base">某支付公司</span>
					<span className="text-base">后端工程师</span>
					<Tag size="small" variant="outlined">
						入职前
					</Tag>
				</div>
			</Example>
			<Example
				description="导出名单时列出表里有哪些列：固定的列描边，随这次搜索条件变的列填充。"
				title="导出的列"
			>
				<Tag variant="outlined">姓名</Tag>
				<Tag variant="outlined">当前岗位</Tag>
				<Tag>支付风控</Tag>
				<Tag>规则引擎</Tag>
			</Example>
			<Example
				description="管理页上任务或数据的状态：状态色写在字和底上，前面一个图标，词本身说出是什么状态。"
				title="运行状态"
			>
				<Tag color="success" icon={CircleCheck} size="small">
					已完成
				</Tag>
				<Tag color="processing" icon={CircleDashed} size="small">
					运行中
				</Tag>
				<Tag color="warning" icon={TriangleAlert} size="small">
					等待中
				</Tag>
				<Tag color="error" size="small">
					失败
				</Tag>
			</Example>
		</ExampleGrid>
	);
}

/** 标签：四种外观、四种状态色、三档尺寸，可带图标、可圆形、可关闭。 */
export function TagPage() {
	const size = useTier("tag");
	return (
		<DocPage
			facts={[
				`${VARIANTS.length} 种外观`,
				`${COLORS.length} 种状态色`,
				`${COMPONENT_TIERS.tag.length} 种尺寸`,
				"可带图标",
				"可关闭",
			]}
			rules={{
				notes: [
					"不带 color 的标签是次要色的字；要状态色用 color，不在 style 里写色值。",
					"状态色只说状态：成功、警告、错误、信息（processing 同信息）。不拿它给普通分类上色。",
					"同一块面上的标签只用一种外观，两种标签只差填充会被读成两类东西。",
					"关闭钮只调 onClose，标签由调用处从数据里移除。",
					"尺寸用 size，不覆盖高度、圆角和内边距。",
				],
				usage: `<Tag color="success" icon={CircleCheck} size="small">\n  已完成\n</Tag>`,
			}}
			sections={[
				{
					children: <Playground />,
					id: "playground",
					tag: size,
					title: "试用标签",
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
