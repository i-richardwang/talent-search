import { ActivityIcon, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Collapse, type CollapseProps } from "#/components/ui/collapse";
import { Descriptions, DescriptionsItem } from "#/components/ui/descriptions";
import { Segmented } from "#/components/ui/segmented";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

type Variant = NonNullable<CollapseProps["variant"]>;

const VARIANTS: Variant[] = ["filled", "outlined", "borderless"];

function Playground() {
	const [variant, setVariant] = useState<Variant>("filled");
	const [collapsible, setCollapsible] = useState(false);
	const [desc, setDesc] = useState(true);
	const [icon, setIcon] = useState(false);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="面">
					<Segmented<Variant>
						onChange={setVariant}
						options={VARIANTS}
						value={variant}
					/>
				</Control>
				<Control>
					<Checkbox checked={collapsible} onChange={setCollapsible}>
						可收起
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={desc} onChange={setDesc}>
						说明
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={icon} onChange={setIcon}>
						图标
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<span className="font-mono">
						{variant}
						{collapsible && " · collapsible"}
					</span>
				}
			>
				<div className="w-full max-w-lg">
					<Collapse
						collapsible={collapsible}
						desc={desc && "每天凌晨从人事系统取一次"}
						extra={<Button size="small">立即运行</Button>}
						icon={icon ? ActivityIcon : undefined}
						title="同步"
						variant={variant}
					>
						<p className="text-base">人才库里有 1,284 份简历、5,902 段经历。</p>
					</Collapse>
				</div>
			</Stage>
		</div>
	);
}

/** 任务页的一张卡：任务名、行尾的「立即运行」，卡里是这项任务的现状。 */
function TaskCard() {
	return (
		<div className="w-full">
			<Collapse extra={<Button size="small">立即运行</Button>} title="派生">
				<div className="flex flex-col gap-2">
					<p className="text-fg-secondary text-xs">上次 3 小时前完成</p>
					<p className="text-base">5,902 段经历里已读 5,870 段。</p>
				</div>
			</Collapse>
		</div>
	);
}

/** 一页上几组内容上下排开，组与组隔 16px；组名说这一组是什么，动作挂在行尾。 */
function Stacked() {
	return (
		<div className="flex w-full flex-col gap-4">
			<Collapse
				extra={
					<ActionIcon icon={MoreHorizontalIcon} size="small" title="更多" />
				}
				title="人才库"
			>
				<Descriptions>
					<DescriptionsItem label="简历">1,284 份</DescriptionsItem>
					<DescriptionsItem label="经历">5,902 段</DescriptionsItem>
				</Descriptions>
			</Collapse>
			<Collapse desc="判定方每周重判一次" title="技能词表">
				<Descriptions>
					<DescriptionsItem label="标准词">812 个</DescriptionsItem>
					<DescriptionsItem label="待判">14 组</DescriptionsItem>
				</Descriptions>
			</Collapse>
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="一张卡说一项任务：名字在头上，动作挂在行尾，现状放在里面那块面上。"
				title="任务卡"
			>
				<TaskCard />
			</Example>
			<Example
				description="几组内容上下排开，每组一个名字，组与组之间 16px。"
				title="分组排列"
			>
				<Stacked />
			</Example>
		</ExampleGrid>
	);
}

/** 分组卡片页：三种面、可收起，任务卡与分组排列两处用法。 */
export function CollapsePage() {
	return (
		<DocPage
			facts={[`${VARIANTS.length} 种面`, "标题 · 说明 · 行尾动作", "可收起"]}
			rules={{
				notes: [
					"一组有名字的内容用 Collapse：title 说这一组是什么，desc 补一句，这一组的动作放 extra，挂在行尾。",
					"filled 是默认：外层极浅的底，内容在里面一块描边的面上；outlined 用在已经有底的面上；borderless 只留标题和内容。",
					"默认不收起；给 collapsible 时标题连同箭头是开关，extra 不是。开合用 open 受控或 defaultOpen 自管。",
					"内容要贴边（比如一张表）时，用 classNames.body 去掉内容层的留白，不在里面再套负外边距。",
				],
				usage: `<Collapse extra={<Button size="small">立即运行</Button>} title="派生">\n  {facts}\n</Collapse>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用分组卡片" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
