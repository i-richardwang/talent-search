import { Search, X } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { Icon } from "#/components/ui/icon";
import { Input, type InputSize } from "#/components/ui/input";
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

function Playground() {
	const size = useTier("input");
	const [slots, setSlots] = useState(true);
	const [disabled, setDisabled] = useState(false);
	const [text, setText] = useState("");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={slots} onChange={setSlots}>
						前后缀
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={disabled} onChange={setDisabled}>
						禁用
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						<span className="font-mono">{size}</span>
						<SizeReading group="input" tier={size} />
						<span>取值 {text ? `${text.length} 字` : "空"}</span>
					</>
				}
			>
				<div className="w-full max-w-xs">
					<Input
						aria-label="经历或技能"
						disabled={disabled}
						onChange={(event) => setText(event.target.value)}
						placeholder="输入关键词"
						prefix={slots ? <Icon icon={Search} size="small" /> : undefined}
						size={size}
						suffix={
							slots && text ? (
								<ActionIcon
									aria-label="清空"
									icon={X}
									onClick={() => setText("")}
									size="small"
								/>
							) : undefined
						}
						value={text}
					/>
				</div>
			</Stage>
		</div>
	);
}

const LOOKS = [
	{ label: "自动", variant: undefined },
	{ label: "filled", variant: "filled" },
] as const;

function States() {
	const size = useTier("input");
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>外观</TableHead>
						<TableHead>空</TableHead>
						<TableHead>有值 · 前缀</TableHead>
						<TableHead>禁用</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{LOOKS.map(({ label, variant }) => (
						<TableRow key={label}>
							<TableCell className="font-mono text-xs">{label}</TableCell>
							<TableCell>
								<Input
									aria-label="经历或技能"
									placeholder="输入关键词"
									size={size}
									variant={variant}
								/>
							</TableCell>
							<TableCell>
								<Input
									aria-label="经历或技能"
									defaultValue="规则引擎"
									prefix={<Icon icon={Search} size="small" />}
									size={size}
									variant={variant}
								/>
							</TableCell>
							<TableCell>
								<Input
									aria-label="经历或技能"
									defaultValue="规则引擎"
									disabled
									size={size}
									variant={variant}
								/>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function SizeRow({ size }: { size: InputSize }) {
	const current = useTier("input");
	return (
		<TableRow data-state={size === current ? "selected" : undefined}>
			<TableCell>
				<SizeCell group="input" tier={size} />
			</TableCell>
			<TableCell>
				<Input aria-label="经历或技能" placeholder="输入关键词" size={size} />
			</TableCell>
			<TableCell>
				<Input
					aria-label="经历或技能"
					placeholder="输入关键词"
					prefix={<Icon icon={Search} size="small" />}
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
						<TableHead>Input</TableHead>
						<TableHead>带前缀</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{COMPONENT_TIERS.input.map((size) => (
						<SizeRow key={size} size={size} />
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
				description="设计系统里按名称找颜色，放在浮层里用 small 档。"
				title="在浮层里找"
			>
				<Input
					aria-label="搜索颜色"
					placeholder="搜索名称或令牌名…"
					size="small"
				/>
			</Example>
			<Example
				description="前缀插槽放说明这一格填什么的短字，不在框外另写标签。"
				title="带前缀的取值"
			>
				<Input
					aria-label="HEX 色值"
					defaultValue="#1677FF"
					prefix={<span className="text-fg-tertiary text-xs">HEX</span>}
				/>
			</Example>
		</ExampleGrid>
	);
}

export function InputPage() {
	const size = useTier("input");
	return (
		<DocPage
			facts={[
				`${LOOKS.length} 种外观`,
				`${COMPONENT_TIERS.input.length} 种尺寸`,
				"前后插槽",
			]}
			rules={{
				notes: [
					"单行输入用 Input；图标与提交放进前后插槽，不在框外另画一圈。",
					'不传 variant 时浅色描边、深色填充，由样式按主题选；深浅两侧都要填充时写 variant="filled"（设计系统的数值框）。',
					"聚焦时边框只加深到 border 那一档，外面一圈淡环；不变成主色的边。",
					"表上方找词用 SearchBar，不拿 Input 加一个「搜索」按钮拼。",
					"尺寸用 size，不覆盖高度、圆角和内边距；宽度属于外层布局。",
					"只有图标的清空、提交按钮用 ActionIcon，并写 aria-label。",
				],
				usage: `<Input\n  placeholder="输入关键词"\n  prefix={<Icon icon={Search} size="small" />}\n/>`,
			}}
			sections={[
				{
					children: <Playground />,
					id: "playground",
					tag: size,
					title: "试用输入框",
				},
				{
					children: <States />,
					id: "states",
					tag: size,
					title: "外观与状态",
				},
				{ children: <Sizes />, id: "sizes", title: "尺寸" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
