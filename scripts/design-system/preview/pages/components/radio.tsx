import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { Radio, RadioGroup } from "#/components/ui/radio";
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
import { px, useMeasured } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

const EDUCATION = [
	{ label: "不限", value: "" },
	{ label: "本科及以上", value: "bachelor" },
	{ label: "硕士及以上", value: "master" },
	{ label: "博士", value: "doctor" },
];

/** 量选中那一项的圆点直径与中心点直径。 */
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
	const [disabled, setDisabled] = useState(false);
	const [oneDisabled, setOneDisabled] = useState(false);
	const picked = EDUCATION.find((option) => option.value === value);
	const { reading, ref } = useMeasured(measureDot);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={disabled} onChange={setDisabled}>
						整组禁用
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={oneDisabled} onChange={setOneDisabled}>
						「博士」禁用
					</Checkbox>
				</Control>
			</Controls>
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
						disabled={disabled}
						onChange={setValue}
						value={value}
					>
						{EDUCATION.map((option) => (
							<Radio
								disabled={option.value === "doctor" && oneDisabled}
								key={option.value}
								value={option.value}
							>
								{option.label}
							</Radio>
						))}
					</RadioGroup>
				</div>
			</Stage>
		</div>
	);
}

/** 一格里一个单项组：Radio 只能放在 RadioGroup 里。 */
function Single({
	checked,
	disabled,
	label,
}: {
	checked?: boolean;
	disabled?: boolean;
	label?: string;
}) {
	return (
		<RadioGroup
			aria-label={label ?? "候选人 A"}
			defaultValue={checked ? "on" : undefined}
		>
			{label ? (
				<Radio disabled={disabled} value="on">
					{label}
				</Radio>
			) : (
				<Radio aria-label="候选人 A" disabled={disabled} value="on" />
			)}
		</RadioGroup>
	);
}

function Appearances() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>内容</TableHead>
						<TableHead>未选</TableHead>
						<TableHead>已选</TableHead>
						<TableHead>禁用</TableHead>
						<TableHead>禁用 · 已选</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{[
						["label", "硕士及以上"],
						["dot", undefined],
					].map(([kind, label]) => (
						<TableRow key={kind}>
							<TableCell className="font-mono text-xs">{kind}</TableCell>
							<TableCell>
								<Single label={label} />
							</TableCell>
							<TableCell>
								<Single checked label={label} />
							</TableCell>
							<TableCell>
								<Single disabled label={label} />
							</TableCell>
							<TableCell>
								<Single checked disabled label={label} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

/** 筛选栏的写法：每一行由调用处排，行尾带人数。 */
function FilterRail() {
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
				description="筛选栏里只能取一个值的维度，第一项是「不限」，行尾是人数。"
				title="筛选栏单选"
			>
				<FilterRail />
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
					<Radio disabled value="new">
						只同步新入库的简历
					</Radio>
				</RadioGroup>
			</Example>
		</ExampleGrid>
	);
}

/** 单选框页：试用单选组、状态、使用场景。 */
export function RadioPage() {
	return (
		<DocPage
			facts={["单选组", "单项禁用"]}
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
