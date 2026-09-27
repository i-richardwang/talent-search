import { useState } from "react";
import { Block } from "#/components/ui/block";
import {
	Descriptions,
	DescriptionsItem,
	type DescriptionsSize,
} from "#/components/ui/descriptions";
import { Segmented } from "#/components/ui/segmented";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

const SIZES: DescriptionsSize[] = ["middle", "small"];

function Person() {
	return (
		<>
			<DescriptionsItem label="部门">推荐算法部</DescriptionsItem>
			<DescriptionsItem label="岗位">高级算法工程师 · L7</DescriptionsItem>
			<DescriptionsItem label="入职时间">
				<span className="tabular-nums">2019-07-01</span>
			</DescriptionsItem>
			<DescriptionsItem label="教育背景">硕士 · 学校 A</DescriptionsItem>
		</>
	);
}

function Playground() {
	const [size, setSize] = useState<DescriptionsSize>("middle");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="尺寸">
					<Segmented<DescriptionsSize>
						onChange={setSize}
						options={SIZES}
						value={size}
					/>
				</Control>
			</Controls>
			<Stage footer={<span className="font-mono">{size}</span>}>
				<div className="w-full max-w-sm">
					<Descriptions size={size}>
						<Person />
					</Descriptions>
				</div>
			</Stage>
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="右栏人的详情顶上：这个人现在在哪、什么岗位、何时入职、什么学历。"
				title="人的属性"
			>
				<div className="w-full">
					<Descriptions>
						<Person />
					</Descriptions>
				</div>
			</Example>
			<Example
				description="数据页的一段经历里，登记的序列、抽出的技能与职责用 small，跟着那一块的小字。"
				title="一段经历的附属属性"
			>
				<Block className="w-full" gap={8} padding={16} variant="outlined">
					<p className="font-medium text-base">算法工程师</p>
					<Descriptions size="small">
						<DescriptionsItem label="序列">技术 · 算法 · 推荐</DescriptionsItem>
						<DescriptionsItem label="技能">推荐系统、排序模型</DescriptionsItem>
					</Descriptions>
				</Block>
			</Example>
		</ExampleGrid>
	);
}

/** 属性列表页：两种尺寸、产品里的两处用法。 */
export function DescriptionsPage() {
	return (
		<DocPage
			facts={[`${SIZES.length} 种尺寸`, "标签栏按最长的定宽"]}
			rules={{
				notes: [
					"一个对象的几条属性用 Descriptions，一条一个 DescriptionsItem；不在调用处另写两栏网格。",
					"标签次要色、内容正文色、字号相同；两栏靠颜色分开，不加冒号，不加粗。",
					"没有值的属性写「—」或者整条不出现，看这一条对读的人有没有意义。",
					"middle 是详情里的主属性；small 是一块里的附属属性，跟着那一块的小字。",
				],
				usage: `<Descriptions>\n  <DescriptionsItem label="部门">{dept}</DescriptionsItem>\n</Descriptions>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用属性列表" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
