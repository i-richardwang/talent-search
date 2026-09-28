import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Radio, RadioGroup } from "#/components/ui/radio";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { DocPage } from "../../kit/page";
import { px, useMeasured } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

const EDUCATION = [
	{ label: "不限", value: "" },
	{ label: "本科及以上", value: "bachelor" },
	{ label: "硕士及以上", value: "master" },
	{ label: "博士", value: "doctor" },
];

function measureDot(root: HTMLElement) {
	const dot = root.querySelector('[role="radio"][aria-checked="true"]');
	const center = dot?.firstElementChild;
	if (!dot || !center) return undefined;
	return {
		center: center.getBoundingClientRect().width,
		dot: dot.getBoundingClientRect().width,
	};
}

function Playground() {
	const [value, setValue] = useState("bachelor");
	const picked = EDUCATION.find((option) => option.value === value);
	const { reading, ref } = useMeasured(measureDot);
	return (
		<Stage
			footer={
				<>
					{reading && (
						<>
							<span>圆点 {px(reading.dot)}</span>
							<span>中心 {px(reading.center)}</span>
						</>
					)}
					<span>当前：{picked?.label ?? "无"}</span>
				</>
			}
		>
			<div className="contents" ref={ref}>
				<RadioGroup
					aria-label="学历"
					className="flex flex-wrap gap-3"
					onChange={setValue}
					value={value}
				>
					{EDUCATION.map((option) => (
						<Radio key={option.value} value={option.value}>
							{option.label}
						</Radio>
					))}
				</RadioGroup>
			</div>
		</Stage>
	);
}

/** Radio 只能放在 RadioGroup 里，单个示例也包一层组。 */
function Single({ checked, label }: { checked?: boolean; label: string }) {
	return (
		<RadioGroup aria-label={label} defaultValue={checked ? "on" : undefined}>
			<Radio value="on">{label}</Radio>
		</RadioGroup>
	);
}

function Appearances() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>未选</TableHead>
						<TableHead>已选</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell>
							<Single label="硕士及以上" />
						</TableCell>
						<TableCell>
							<Single checked label="硕士及以上" />
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</Block>
	);
}

function FilterGroup() {
	const counts: Record<string, number> = {
		"": 190,
		bachelor: 164,
		doctor: 6,
		master: 58,
	};
	const [value, setValue] = useState("");
	return (
		<RadioGroup
			aria-label="学历"
			className="w-full"
			onChange={setValue}
			value={value}
		>
			<div className="flex w-full flex-col gap-2">
				{EDUCATION.map((option) => (
					<div
						className="flex items-center justify-between gap-3"
						key={option.value}
					>
						<Radio value={option.value}>{option.label}</Radio>
						<span className="text-fg-tertiary text-xs tabular-nums">
							{counts[option.value]} 人
						</span>
					</div>
				))}
			</div>
		</RadioGroup>
	);
}

function Usage() {
	const [order, setOrder] = useState("relevance");
	const [range, setRange] = useState("30");
	return (
		<ExampleGrid>
			<Example
				description="搜索结果页导航栏的筛选里，只能取一个值的维度：第一项是「不限」，行尾是人数。"
				title="筛选单选"
			>
				<FilterGroup />
			</Example>
			<Example
				description="几个互斥的选项全部摆出来，读者一眼看完再选。"
				title="互斥选项"
			>
				<RadioGroup
					aria-label="名单排序"
					className="flex gap-3"
					onChange={setOrder}
					value={order}
				>
					<Radio value="relevance">按匹配程度</Radio>
					<Radio value="years">按累计年限</Radio>
				</RadioGroup>
			</Example>
			<Example description="选项文字较长时竖排，每项一行。" title="竖排">
				<RadioGroup
					aria-label="同步范围"
					className="flex flex-col gap-2"
					onChange={setRange}
					value={range}
				>
					<Radio value="30">最近 30 天有变动的简历</Radio>
					<Radio value="all">人才库里的全部简历</Radio>
					<Radio value="new">只同步新入库的简历</Radio>
				</RadioGroup>
			</Example>
		</ExampleGrid>
	);
}

export function RadioPage() {
	return (
		<DocPage
			facts={["单选组"]}
			rules={{
				notes: [
					"单选用 Radio，多选用 Checkbox，一次动作用 Button。",
					"Radio 只能放在 RadioGroup 里，选中哪一项由组持有。",
					"组只持有取值，不带布局：横排、竖排、行尾计数都由调用处排。",
					"没有选择也是一种取值时，第一项写「不限」。",
					"圆点的尺寸固定，不覆盖圆点的尺寸、边框和圆角。",
				],
				usage: `<RadioGroup aria-label="学历" onChange={setValue} value={value}>\n  <Radio value="">不限</Radio>\n  <Radio value="bachelor">本科及以上</Radio>\n</RadioGroup>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用单选组" },
				{ children: <Appearances />, id: "appearance", title: "状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
