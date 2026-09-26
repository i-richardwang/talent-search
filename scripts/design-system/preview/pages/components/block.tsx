import { type ComponentProps, useState } from "react";
import { Block, BlockLink } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
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
import { Example, ExampleGrid, Stage } from "../../kit/stage";

type Variant = NonNullable<ComponentProps<typeof Block>["variant"]>;

const VARIANTS: Variant[] = ["filled", "outlined"];

/** 一块面里放的内容：一位合成候选人的摘要。 */
function Summary({ name = "Talent 0123" }: { name?: string }) {
	return (
		<>
			<div className="font-medium text-sm">{name}</div>
			<div className="text-fg-secondary text-xs">
				数据平台部 · 推荐系统 6 年
			</div>
		</>
	);
}

function Playground() {
	const [variant, setVariant] = useState<Variant>("outlined");
	const [clickable, setClickable] = useState(true);
	const [selected, setSelected] = useState(false);
	const [shadow, setShadow] = useState(false);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="外观">
					<Segmented<Variant>
						onChange={setVariant}
						options={[
							{ label: "填充", value: "filled" },
							{ label: "描边", value: "outlined" },
						]}
						value={variant}
					/>
				</Control>
				<Control>
					<Checkbox
						checked={clickable && variant === "outlined"}
						disabled={variant !== "outlined"}
						onChange={setClickable}
					>
						可点击（描边面）
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={selected} onChange={setSelected}>
						选中
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={shadow} onChange={setShadow}>
						投影
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<span className="font-mono">
						{[
							variant,
							clickable && variant === "outlined" && "clickable",
							selected && "selected",
							shadow && "shadow",
						]
							.filter(Boolean)
							.join(" · ")}
					</span>
				}
			>
				<Block
					className="w-72"
					clickable={clickable && variant === "outlined"}
					gap={4}
					padding={16}
					selected={selected}
					shadow={shadow}
					variant={variant}
				>
					<Summary />
				</Block>
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
						<TableHead>外观</TableHead>
						<TableHead>常态</TableHead>
						<TableHead>可点击（悬停看，只用在描边面）</TableHead>
						<TableHead>选中</TableHead>
						<TableHead>投影</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{VARIANTS.map((variant) => (
						<TableRow key={variant}>
							<TableCell className="font-mono text-xs">{variant}</TableCell>
							<TableCell>
								<Block gap={4} padding={12} variant={variant}>
									<Summary />
								</Block>
							</TableCell>
							<TableCell>
								{variant === "outlined" ? (
									<Block clickable gap={4} padding={12} variant={variant}>
										<Summary />
									</Block>
								) : (
									<span className="text-fg-tertiary">—</span>
								)}
							</TableCell>
							<TableCell>
								<Block gap={4} padding={12} selected variant={variant}>
									<Summary />
								</Block>
							</TableCell>
							<TableCell>
								<Block gap={4} padding={12} shadow variant={variant}>
									<Summary />
								</Block>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

/** 候选人卡片：名字是真链接，覆盖层铺满整块，正在看的那一张选中。 */
function Cards() {
	const [current, setCurrent] = useState("0123");
	return (
		<div className="grid w-full grid-cols-2 gap-2">
			{["0123", "0456"].map((id) => (
				<Block
					clickable
					gap={4}
					key={id}
					padding={12}
					selected={id === current}
					variant="outlined"
				>
					<BlockLink
						aria-current={id === current ? "page" : undefined}
						className="font-medium text-sm"
						href={`#person-${id}`}
						onClick={(event) => {
							event.preventDefault();
							setCurrent(id);
						}}
					>
						Talent {id}
					</BlockLink>
					<div className="text-fg-secondary text-xs">
						数据平台部 · 推荐系统 6 年
					</div>
				</Block>
			))}
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="名字是 BlockLink，铺满整块，中键、右键和键盘都能用；选中用 selected。"
				title="候选人卡片"
			>
				<Cards />
			</Example>
			<Example
				description="同一个对象的几块面：外面一块填充的，里面放描边的。"
				title="同一对象的多块面"
			>
				<Block className="w-full" gap={8} padding={8} variant="filled">
					<Block gap={4} padding={12} variant="outlined">
						<div className="text-fg-secondary text-xs">登记经历</div>
						<div className="text-sm">数据平台部 · 推荐系统负责人</div>
					</Block>
					<Block gap={4} padding={12} variant="outlined">
						<div className="text-fg-secondary text-xs">简历自述</div>
						<div className="text-sm">搭建过召回与排序两层的推荐链路</div>
					</Block>
				</Block>
			</Example>
		</ExampleGrid>
	);
}

/** 块页：试用、外观与状态、使用场景。 */
export function BlockPage() {
	return (
		<DocPage
			facts={[`${VARIANTS.length} 种外观`, "可点击", "选中态"]}
			rules={{
				notes: [
					"一块面用 Block，不手写 border、shadow、rounded 组合。",
					"同一对象的多块面是填充的 Block 里放描边的 Block；表放在描边的 Block 里。",
					"整块可点击必须是真链接：块里的那条链接用 BlockLink，它铺满整块、焦点框画在整块上；覆盖层内不嵌套别的动作，选择框放块外。",
					"选中用 selected，不另加选中装饰。",
					"Block 本身是 Flexbox，间距和内边距用 gap、padding。",
				],
				usage: `<Block gap={4} padding={16} variant="outlined">\n  <div>Talent 0123</div>\n  <div>数据平台部 · 推荐系统 6 年</div>\n</Block>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用块" },
				{ children: <Appearances />, id: "appearance", title: "外观与状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
