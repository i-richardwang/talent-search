import { Search, X } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { Form } from "#/components/ui/form";
import { Icon } from "#/components/ui/icon";
import {
	Input,
	InputNumber,
	type InputSize,
	type InputVariant,
	TextArea,
} from "#/components/ui/input";
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

type Kind = "input" | "textarea" | "number";

const KINDS: { label: string; value: Kind }[] = [
	{ label: "Input", value: "input" },
	{ label: "TextArea", value: "textarea" },
	{ label: "InputNumber", value: "number" },
];
/** `auto` 表示不传 variant：浅色描边、深色填充。 */
type VariantChoice = InputVariant | "auto";

const VARIANTS: VariantChoice[] = ["auto", "filled", "outlined", "borderless"];
const variantOf = (choice: VariantChoice) =>
	choice === "auto" ? undefined : choice;

function Playground() {
	const size = useTier("input");
	const [kind, setKind] = useState<Kind>("input");
	const [variant, setVariant] = useState<VariantChoice>("auto");
	const [slots, setSlots] = useState(true);
	const [disabled, setDisabled] = useState(false);
	const [text, setText] = useState("");
	const [years, setYears] = useState<number | null>(3);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="组件">
					<Segmented<Kind> onChange={setKind} options={KINDS} value={kind} />
				</Control>
				{kind === "input" && (
					<Control label="外观">
						<Segmented<VariantChoice>
							onChange={setVariant}
							options={[
								{ label: "自动", value: "auto" },
								{ label: "填充", value: "filled" },
							]}
							value={variant}
						/>
					</Control>
				)}
				<Control>
					<Checkbox
						checked={slots}
						disabled={kind !== "input"}
						onChange={setSlots}
					>
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
						{kind === "textarea" ? (
							<span>没有尺寸档，高度由行数决定</span>
						) : (
							<>
								<span className="font-mono">
									{kind === "input" ? size : "middle"}
								</span>
								<SizeReading
									group="input"
									tier={kind === "input" ? size : "middle"}
								/>
							</>
						)}
						<span>
							取值{" "}
							{kind === "number"
								? (years ?? "空")
								: text
									? `${text.length} 字`
									: "空"}
						</span>
					</>
				}
			>
				<div className="w-full max-w-xs">
					{kind === "input" && (
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
							variant={variantOf(variant)}
						/>
					)}
					{kind === "textarea" && (
						<TextArea
							aria-label="需求"
							autoSize={{ minRows: 2 }}
							disabled={disabled}
							onChange={(event) => setText(event.target.value)}
							placeholder="描述要找的人，比如做过支付风控、带过团队的后端"
							value={text}
						/>
					)}
					{kind === "number" && (
						<Form layout="vertical">
							<Form.Field label="累计年限（至少）">
								<InputNumber
									disabled={disabled}
									min={0.5}
									onChange={setYears}
									placeholder="不限"
									step={0.5}
									value={years}
								/>
							</Form.Field>
						</Form>
					)}
				</div>
			</Stage>
		</div>
	);
}

function Appearances() {
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
					{VARIANTS.map((choice) => {
						const variant = variantOf(choice);
						return (
							<TableRow key={choice}>
								<TableCell className="font-mono text-xs">
									{choice === "auto" ? "自动" : choice}
								</TableCell>
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
						);
					})}
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
		<div className="flex flex-col gap-2">
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
			<p className="text-fg-tertiary text-xs">
				TextArea 与 InputNumber 没有 size，按 middle 档；TextArea
				的高度由行数决定。
			</p>
		</div>
	);
}

function Usage() {
	const [need, setNeed] = useState("");
	const [years, setYears] = useState<number | null>(null);
	return (
		<ExampleGrid>
			<Example
				description="AI 搜索的需求框随内容长高，minRows 定最少几行，空着时也留出两行的位置。"
				title="写需求"
			>
				<TextArea
					aria-label="需求"
					autoSize={{ minRows: 2 }}
					onChange={(event) => setNeed(event.target.value)}
					placeholder="描述要找的人，比如做过支付风控、带过团队的后端"
					value={need}
				/>
			</Example>
			<Example
				description="管理页的表上方按词找，图标放进前缀插槽，不在框外另画。"
				title="在表里找"
			>
				<Input
					aria-label="按技能词找"
					placeholder="按技能词找"
					prefix={<Icon icon={Search} size="small" />}
				/>
			</Example>
			<Example
				description="数字用 InputNumber：min 和 step 管住取值，空着表示不限。"
				title="累计年限"
			>
				<Form className="w-full" layout="vertical">
					<Form.Field desc="每项经历分别计算" label="累计年限（至少）">
						<InputNumber
							min={0.5}
							onChange={setYears}
							placeholder="不限"
							step={0.5}
							value={years}
						/>
					</Form.Field>
				</Form>
			</Example>
			<Example
				description="字段校验不通过时外壳换成错误色的边，说明写在字段下方。"
				title="取值不合规"
			>
				<Form className="w-full" layout="vertical">
					<Form.Field desc="年限至少 0.5 年" invalid label="累计年限（至少）">
						<InputNumber defaultValue={0} />
					</Form.Field>
				</Form>
			</Example>
		</ExampleGrid>
	);
}

/** 输入框：Input、TextArea、InputNumber 共用一套外壳；Input 有两种外观取法、两档尺寸。 */
export function InputPage() {
	const size = useTier("input");
	return (
		<DocPage
			facts={[
				`${KINDS.length} 种组件`,
				`${VARIANTS.length} 种外观`,
				`${COMPONENT_TIERS.input.length} 种尺寸`,
			]}
			rules={{
				notes: [
					"输入用 Input / TextArea，数字用 InputNumber；图标与提交放进前后插槽或底栏，不在框外另画一圈。",
					'不传 variant 时浅色描边、深色填充，由样式按主题选；深浅两侧都要填充时才写 variant="filled"，都要描边时写 variant="outlined"；嵌在别的面里（输入托盘的一行）用 variant="borderless"。',
					"聚焦时边框只加深到 border 那一档，外面一圈淡环；不变成主色的边。",
					"表上方找词用 SearchBar，不拿 Input 加一个「搜索」按钮拼。",
					"尺寸用 size，不覆盖高度、圆角和内边距；宽度属于外层布局。",
					"多行输入要长高时用 autoSize，minRows 定最少几行。",
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
