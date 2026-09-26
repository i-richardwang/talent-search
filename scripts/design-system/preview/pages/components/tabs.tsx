import { type ComponentProps, type ReactNode, useState } from "react";
import { Block } from "#/components/ui/block";
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
import { Tabs } from "#/components/ui/tabs";
import { Tag } from "#/components/ui/tag";
import { COMPONENT_TIERS } from "../../../shared/tokens/registry";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { SizeCell, SizeReading } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { useTier } from "../../state";

type TabsProps = ComponentProps<typeof Tabs>;
type TabsVariant = NonNullable<TabsProps["variant"]>;
type TabsSize = NonNullable<TabsProps["size"]>;
type TabsItem = NonNullable<TabsProps["items"]>[number];

const VARIANTS: TabsVariant[] = ["rounded", "point"];

/** 人的详情里的三块内容；`disableRaw` 把「简历原文」设为禁用。 */
function detailItems({
	disableRaw = false,
}: {
	disableRaw?: boolean;
} = {}): TabsItem[] {
	return [
		{ key: "experience", label: "经历" },
		{ key: "evidence", label: "证据" },
		{ disabled: disableRaw, key: "raw", label: "简历原文" },
	];
}

/** 面板里的一段示例正文。 */
function PanelText({ children }: { children: ReactNode }) {
	return <p className="text-fg-secondary text-sm leading-6">{children}</p>;
}

const PANEL_TEXT: Record<string, string> = {
	evidence: "登记证据 2 条，简历自述 3 条，命中「数据平台」「团队管理」。",
	experience: "2019 – 至今 · 数据平台研发，负责离线计算与调度。",
	raw: "这一段还没读过，显示简历里的整段原文。",
};

function Playground() {
	const size = useTier("tabs");
	const [variant, setVariant] = useState<TabsVariant>("rounded");
	const [disableRaw, setDisableRaw] = useState(false);
	const [active, setActive] = useState("experience");
	const items = detailItems({ disableRaw }).map((item) => ({
		...item,
		children: <PanelText>{PANEL_TEXT[item.key]}</PanelText>,
	}));
	const current = disableRaw && active === "raw" ? "experience" : active;
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="外观">
					<Segmented<TabsVariant>
						onChange={setVariant}
						options={VARIANTS.map((value) => ({ label: value, value }))}
						value={variant}
					/>
				</Control>
				<Control>
					<Checkbox checked={disableRaw} onChange={setDisableRaw}>
						禁用「简历原文」
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				className="items-stretch justify-start"
				footer={
					<>
						<span className="font-mono">{size}</span>
						<SizeReading group="tabs" tier={size} />
						<span>选中 {current}</span>
					</>
				}
			>
				<Tabs
					activeKey={current}
					items={items}
					onChange={setActive}
					size={size}
					variant={variant}
				/>
			</Stage>
		</div>
	);
}

function Appearances() {
	const size = useTier("tabs");
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>外观</TableHead>
						<TableHead>默认 · 可交互</TableHead>
						<TableHead>含禁用项</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{VARIANTS.map((variant) => (
						<TableRow key={variant}>
							<TableCell className="font-mono text-xs">{variant}</TableCell>
							<TableCell>
								<Tabs items={detailItems()} size={size} variant={variant} />
							</TableCell>
							<TableCell>
								<Tabs
									items={detailItems({ disableRaw: true })}
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

function SizeRow({ size }: { size: TabsSize }) {
	const current = useTier("tabs");
	return (
		<TableRow data-state={size === current ? "selected" : undefined}>
			<TableCell>
				<SizeCell group="tabs" tier={size} />
			</TableCell>
			{VARIANTS.map((variant) => (
				<TableCell key={variant}>
					<Tabs items={detailItems()} size={size} variant={variant} />
				</TableCell>
			))}
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
						{VARIANTS.map((variant) => (
							<TableHead className="font-mono" key={variant}>
								{variant}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{COMPONENT_TIERS.tabs.map((size) => (
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
				description="同一位候选人的几块内容用 rounded 切换，面板接在标签下面，读的是同一个人。"
				title="人的详情"
			>
				<Tabs
					items={[
						{
							children: (
								<PanelText>
									候选人 A · 2019 – 至今 · 数据平台研发，累计 6 年。
								</PanelText>
							),
							key: "experience",
							label: "经历",
						},
						{
							children: (
								<div className="flex flex-wrap gap-2">
									<Tag size="small">数据平台 · 登记</Tag>
									<Tag size="small">任务调度 · 简历自述</Tag>
								</div>
							),
							key: "evidence",
							label: "证据",
						},
						{
							children: <PanelText>负责离线计算平台的调度与监控……</PanelText>,
							key: "raw",
							label: "简历原文",
						},
					]}
					size="small"
				/>
			</Example>
			<Example
				description="简历的段都已读过时没有原文可看，「简历原文」留在原位禁用，不抽掉，标签不挪位。"
				title="暂时没有的内容"
			>
				<Tabs items={detailItems({ disableRaw: true })} size="small" />
			</Example>
			<Example
				description="栏头上切换同一栏的几块内容，面板由栏自己画；point 只在选中项下方画一个点，贴着栏头不显重。"
				title="栏头上的分区"
			>
				<Tabs
					items={[
						{ key: "design", label: "设计" },
						{ key: "changes", label: "修改" },
					]}
					size="small"
					variant="point"
				/>
			</Example>
		</ExampleGrid>
	);
}

/** 选项卡页：试用、外观与状态、尺寸、使用场景。 */
export function TabsPage() {
	const size = useTier("tabs");
	return (
		<DocPage
			facts={[
				`${VARIANTS.length} 种外观`,
				`${COMPONENT_TIERS.tabs.length} 种尺寸`,
			]}
			rules={{
				notes: [
					"同一对象的几块内容用 Tabs 切换；单选取值用 Radio，筛选里的档位用 Segmented。",
					"尺寸和外观用 size / variant，不覆盖高度、圆角和内边距；宽度属于外层布局。",
					"选中态由指示块表达，不另加底色、边框之类的选中装饰。",
					"暂时不可用的项用 disabled 留在原位，不从 items 里抽掉。",
					"面板写在 items 的 children 里；面板由外面自己画时 items 不带 children，只用 activeKey 与 onChange。",
				],
				usage: `<Tabs\n  items={[\n    { key: "experience", label: "经历", children: <Experience /> },\n    { key: "evidence", label: "证据", children: <Evidence /> },\n  ]}\n/>`,
			}}
			sections={[
				{
					children: <Playground />,
					id: "playground",
					tag: size,
					title: "试用选项卡",
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
