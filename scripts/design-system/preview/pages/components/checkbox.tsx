import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox, CheckboxGroup } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
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
import { px, useMeasured } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

type Mark = "unchecked" | "checked" | "indeterminate";

const MARK_LABEL: Record<Mark, string> = {
	checked: "已勾选",
	indeterminate: "半选",
	unchecked: "未勾选",
};

const CHANNELS = [
	{ label: "校园招聘", value: "campus" },
	{ label: "社会招聘", value: "social" },
	{ label: "内部推荐", value: "referral" },
	{ label: "猎头", value: "headhunter" },
];

function measureBox(root: HTMLElement) {
	const box = root.querySelector('[role="checkbox"]');
	const text = box?.nextElementSibling;
	if (!box || !text) return undefined;
	const boxRect = box.getBoundingClientRect();
	return {
		box: boxRect.width,
		gap: text.getBoundingClientRect().left - boxRect.right,
	};
}

function Playground() {
	const [label, setLabel] = useState("只看有登记证据的人");
	const [mark, setMark] = useState<Mark>("checked");
	const [disabled, setDisabled] = useState(false);
	const { reading, ref } = useMeasured(measureBox);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control
					className="grow"
					htmlFor="checkbox-playground-label"
					label="标签文字"
				>
					<Input
						id="checkbox-playground-label"
						onChange={(event) => setLabel(event.target.value)}
						value={label}
						variant="filled"
					/>
				</Control>
				<Control label="勾选">
					<Segmented<Mark>
						onChange={setMark}
						options={[
							{ label: MARK_LABEL.unchecked, value: "unchecked" },
							{ label: MARK_LABEL.checked, value: "checked" },
							{ label: MARK_LABEL.indeterminate, value: "indeterminate" },
						]}
						value={mark}
					/>
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
						{reading && (
							<>
								<span>边长 {px(reading.box)}</span>
								<span>文字间距 {px(reading.gap)}</span>
							</>
						)}
						<span>{MARK_LABEL[mark]}</span>
					</>
				}
			>
				<div className="contents" ref={ref}>
					<Checkbox
						checked={mark === "checked"}
						disabled={disabled}
						indeterminate={mark === "indeterminate"}
						onChange={(checked) => setMark(checked ? "checked" : "unchecked")}
					>
						{label}
					</Checkbox>
				</div>
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
						<TableHead>写法</TableHead>
						<TableHead>未勾选</TableHead>
						<TableHead>已勾选</TableHead>
						<TableHead>半选</TableHead>
						<TableHead>禁用</TableHead>
						<TableHead>禁用 · 已勾选</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell className="font-mono text-xs">children</TableCell>
						<TableCell>
							<Checkbox>校园招聘</Checkbox>
						</TableCell>
						<TableCell>
							<Checkbox defaultChecked>校园招聘</Checkbox>
						</TableCell>
						<TableCell>
							<Checkbox indeterminate>全选</Checkbox>
						</TableCell>
						<TableCell>
							<Checkbox disabled>校园招聘</Checkbox>
						</TableCell>
						<TableCell>
							<Checkbox defaultChecked disabled>
								校园招聘
							</Checkbox>
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">aria-label</TableCell>
						<TableCell>
							<Checkbox aria-label="未勾选" />
						</TableCell>
						<TableCell>
							<Checkbox aria-label="已勾选" defaultChecked />
						</TableCell>
						<TableCell>
							<Checkbox aria-label="半选" indeterminate />
						</TableCell>
						<TableCell>
							<Checkbox aria-label="禁用" disabled />
						</TableCell>
						<TableCell>
							<Checkbox aria-label="禁用且已勾选" defaultChecked disabled />
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">size=18</TableCell>
						<TableCell>
							<Checkbox aria-label="未勾选" size={18} />
						</TableCell>
						<TableCell>
							<Checkbox aria-label="已勾选" defaultChecked size={18} />
						</TableCell>
						<TableCell>
							<Checkbox aria-label="半选" indeterminate size={18} />
						</TableCell>
						<TableCell>
							<Checkbox aria-label="禁用" disabled size={18} />
						</TableCell>
						<TableCell>
							<Checkbox
								aria-label="禁用且已勾选"
								defaultChecked
								disabled
								size={18}
							/>
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</Block>
	);
}

function SelectAll() {
	const people = ["Talent 0123", "Talent 0456", "Talent 0789"];
	const [picked, setPicked] = useState<string[]>(["Talent 0123"]);
	return (
		<CheckboxGroup
			allValues={people}
			aria-label="候选人"
			onChange={setPicked}
			value={picked}
		>
			<div className="flex flex-col gap-2">
				<Checkbox parent>
					已选 {picked.length} / {people.length} 位候选人
				</Checkbox>
				<div className="flex flex-col gap-2 pl-6">
					{people.map((name) => (
						<Checkbox key={name} value={name}>
							{name}
						</Checkbox>
					))}
				</div>
			</div>
		</CheckboxGroup>
	);
}

function FilterGroup() {
	const counts: Record<string, number> = {
		campus: 42,
		headhunter: 3,
		referral: 17,
		social: 128,
	};
	const [value, setValue] = useState<string[]>(["social"]);
	return (
		<CheckboxGroup
			aria-label="招聘渠道"
			className="w-full"
			onChange={setValue}
			value={value}
		>
			<div className="flex w-full flex-col gap-2">
				{CHANNELS.map((channel) => (
					<div
						className="flex items-center justify-between gap-3"
						key={channel.value}
					>
						<Checkbox value={channel.value}>{channel.label}</Checkbox>
						<span className="text-fg-tertiary text-xs tabular-nums">
							{counts[channel.value]} 人
						</span>
					</div>
				))}
			</div>
		</CheckboxGroup>
	);
}

function Usage() {
	const [evidence, setEvidence] = useState(true);
	return (
		<ExampleGrid>
			<Example
				description="搜索结果页导航栏的筛选里，一个维度能多选，每项后面是这次检索里的人数。"
				title="筛选多选"
			>
				<FilterGroup />
			</Example>
			<Example
				description="名单只选了一部分时，全选框显示半选；点它全选或全清。"
				title="全选与半选"
			>
				<SelectAll />
			</Example>
			<Example
				description="一个是或否的设置用一个复选框，文字写勾上之后的结果。"
				title="单项设置"
			>
				<Checkbox checked={evidence} onChange={setEvidence}>
					导出时附上每条搜索条件的匹配证据
				</Checkbox>
			</Example>
			<Example
				description="没有文字时只渲染方框，放在表格或卡片外侧做选择。"
				title="只有方框"
			>
				<Checkbox aria-label="选择候选人 A" defaultChecked />
				<span className="text-sm">候选人 A</span>
			</Example>
		</ExampleGrid>
	);
}

export function CheckboxPage() {
	return (
		<DocPage
			facts={[`${Object.keys(MARK_LABEL).length} 种状态`, "复选框组"]}
			rules={{
				notes: [
					"多选用 Checkbox，单选用 Radio，一次动作用 Button。",
					"一组选项用 CheckboxGroup 持有取值，行由调用处排，行尾可以放人数。",
					"全选框写 parent、组给 allValues，半选由组算出，不另画一种图标。",
					"可点击的一行里，选择框放在压住链接覆盖层的选择格里（ListView 的 pick），不嵌进链接。",
					"方框边长用 size 给（默认 16，可多选的列表里 18），圆角随边长走，不在调用处覆盖。",
				],
				usage: `<CheckboxGroup aria-label="招聘渠道" onChange={setValue} value={value}>\n  <Checkbox value="campus">校园招聘</Checkbox>\n  <Checkbox value="social">社会招聘</Checkbox>\n</CheckboxGroup>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用复选框" },
				{ children: <Appearances />, id: "appearance", title: "状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
