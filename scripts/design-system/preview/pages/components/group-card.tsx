import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Descriptions, DescriptionsItem } from "#/components/ui/descriptions";
import { GroupCard } from "#/components/ui/group-card";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

function Playground() {
	const [desc, setDesc] = useState(true);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={desc} onChange={setDesc}>
						说明
					</Checkbox>
				</Control>
			</Controls>
			<Stage>
				<div className="w-full max-w-lg">
					<GroupCard
						desc={desc && "每天凌晨从人事系统取一次"}
						extra={<Button size="small">立即运行</Button>}
						title="同步"
					>
						<p className="text-base">人才库里有 1,284 份简历、5,902 段经历。</p>
					</GroupCard>
				</div>
			</Stage>
		</div>
	);
}

function TaskCard() {
	return (
		<div className="w-full">
			<GroupCard extra={<Button size="small">立即运行</Button>} title="派生">
				<div className="flex flex-col gap-2">
					<p className="text-fg-secondary text-xs">上次 3 小时前完成</p>
					<p className="text-base">5,902 段经历里已读 5,870 段。</p>
				</div>
			</GroupCard>
		</div>
	);
}

function Stacked() {
	return (
		<div className="flex w-full flex-col gap-4">
			<GroupCard
				extra={
					<ActionIcon icon={MoreHorizontalIcon} size="small" title="更多" />
				}
				title="人才库"
			>
				<Descriptions>
					<DescriptionsItem label="简历">1,284 份</DescriptionsItem>
					<DescriptionsItem label="经历">5,902 段</DescriptionsItem>
				</Descriptions>
			</GroupCard>
			<GroupCard desc="判定方每周重判一次" title="技能词表">
				<Descriptions>
					<DescriptionsItem label="标准词">812 个</DescriptionsItem>
					<DescriptionsItem label="待判">14 组</DescriptionsItem>
				</Descriptions>
			</GroupCard>
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
			<Example description="几组内容上下排开，每组一个名字。" title="分组排列">
				<Stacked />
			</Example>
		</ExampleGrid>
	);
}

export function GroupCardPage() {
	return (
		<DocPage
			facts={["标题 · 说明 · 行尾动作"]}
			rules={{
				notes: [
					"一组有名字的内容用 GroupCard：title 说这一组是什么，desc 补一句，这一组的动作放 extra，挂在行尾。",
					"外层极浅的底，内容在里面一块描边的面上；内容一直展开，不收起。",
				],
				usage: `<GroupCard extra={<Button size="small">立即运行</Button>} title="派生">\n  {facts}\n</GroupCard>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用分组卡片" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
