import { SearchX } from "lucide-react";
import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Center, Flexbox, type FlexboxProps } from "#/components/ui/flex";
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
import { Tag } from "#/components/ui/tag";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

/** 不给 justify 时从主轴起点排。 */
type Justify = NonNullable<FlexboxProps["justify"]> | "flex-start";
/** 不给 align 时交叉轴拉伸。 */
type Align = NonNullable<FlexboxProps["align"]> | "stretch";

const SKILLS = ["推荐系统", "Go", "Kubernetes", "数据治理", "用户增长"];

const JUSTIFY: Justify[] = ["flex-start", "center"];
const ALIGN: Align[] = ["stretch", "center"];

const GAPS = ["0", "4", "8", "16"] as const;

function Skills({ count = 3 }: { count?: number }) {
	return SKILLS.slice(0, count).map((skill) => <Tag key={skill}>{skill}</Tag>);
}

function Playground() {
	const [horizontal, setHorizontal] = useState(true);
	const [justify, setJustify] = useState<Justify>("flex-start");
	const [align, setAlign] = useState<Align>("center");
	const [gap, setGap] = useState<(typeof GAPS)[number]>("8");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="主轴">
					<Segmented<"row" | "column">
						onChange={(next) => setHorizontal(next === "row")}
						options={[
							{ label: "横向", value: "row" },
							{ label: "纵向", value: "column" },
						]}
						value={horizontal ? "row" : "column"}
					/>
				</Control>
				<Control label="主轴分布">
					<Segmented<Justify>
						onChange={setJustify}
						options={JUSTIFY.map((value) => ({ label: value, value }))}
						value={justify}
					/>
				</Control>
				<Control label="交叉轴对齐">
					<Segmented<Align>
						onChange={setAlign}
						options={ALIGN.map((value) => ({ label: value, value }))}
						value={align}
					/>
				</Control>
				<Control label="间距">
					<Segmented<(typeof GAPS)[number]>
						onChange={setGap}
						options={GAPS.map((value) => ({ label: `${value}px`, value }))}
						value={gap}
					/>
				</Control>
			</Controls>
			<Stage
				className="items-stretch"
				footer={
					<span className="font-mono">
						{horizontal ? "horizontal" : "vertical"} · justify={justify} ·
						align={align} · gap={gap}
					</span>
				}
			>
				<Block padding={12} variant="filled">
					<Flexbox
						align={align === "stretch" ? undefined : align}
						gap={Number(gap)}
						height={horizontal ? undefined : 200}
						horizontal={horizontal}
						justify={justify === "flex-start" ? undefined : justify}
					>
						<Skills count={5} />
					</Flexbox>
				</Block>
			</Stage>
		</div>
	);
}

function Distributions() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>justify</TableHead>
						<TableHead className="w-full">横向 · gap 8</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{JUSTIFY.map((justify) => (
						<TableRow key={justify}>
							<TableCell className="whitespace-nowrap font-mono text-xs">
								{justify}
							</TableCell>
							<TableCell>
								<Block padding={8} variant="filled">
									<Flexbox
										gap={8}
										horizontal
										justify={justify === "flex-start" ? undefined : justify}
									>
										<Skills />
									</Flexbox>
								</Block>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function CenterDemo() {
	return (
		<Stage className="items-stretch">
			<Block padding={0} variant="filled">
				<Center gap={8} height={160}>
					<Icon icon={SearchX} size={24} />
					<span className="text-fg-secondary text-sm">
						两个轴都居中，常用来放一个图标或一句话。
					</span>
				</Center>
			</Block>
		</Stage>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="纵向排列是默认值，一列字段或证据按 gap 隔开。"
				title="纵向一列"
			>
				<Flexbox gap={4}>
					<span className="text-sm">Talent 0123</span>
					<span className="text-fg-secondary text-xs">数据平台部</span>
					<span className="text-fg-tertiary text-xs">累计 6 年</span>
				</Flexbox>
			</Example>
		</ExampleGrid>
	);
}

export function FlexPage() {
	return (
		<DocPage
			facts={["横排与竖排", `${JUSTIFY.length} 种主轴分布`, "居中"]}
			rules={{
				notes: [
					"Flexbox 默认纵向，horizontal 换成横向；数字按像素。",
					"主轴只有起点和居中（center）两种分布；交叉轴默认拉伸，可给 center。",
					"两个轴都居中用 Center，不自己组合 align 和 justify。",
					"要画面时用 Block，它就是带面样式的 Flexbox。",
				],
				usage: `<Flexbox gap={4}>\n  <span>{name}</span>\n  <span>{department}</span>\n</Flexbox>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用弹性布局" },
				{ children: <Distributions />, id: "appearance", title: "主轴分布" },
				{ children: <CenterDemo />, id: "center", title: "居中 Center" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
