import { XIcon } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import type { Placement } from "#/components/ui/floating";
import { Popover } from "#/components/ui/popover";
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

type Trigger = "hover" | "click";

/** 试用区列出的方位。 */
const PLACEMENTS: { label: string; value: Placement }[] = [
	{ label: "上", value: "top" },
	{ label: "下", value: "bottom" },
	{ label: "左下", value: "bottomLeft" },
	{ label: "右下", value: "bottomRight" },
	{ label: "左", value: "left" },
];

const TRIGGERS: [trigger: Trigger, opens: string, when: string][] = [
	["hover", "悬停打开，移开收起", "只读的补充信息"],
	["click", "点击打开，点外面或 Esc 收起", "里面有输入或按钮"],
];

function EvidenceSummary() {
	return (
		<div className="flex max-w-64 flex-col gap-1.5 text-xs">
			<span className="font-medium text-sm">Go 并发调度</span>
			<span className="text-fg-secondary">3 段经历提到，累计 4 年 2 个月</span>
			<span className="text-fg-tertiary">最近一段：2022-03 至今</span>
		</div>
	);
}

function Playground() {
	const [trigger, setTrigger] = useState<Trigger>("click");
	const [placement, setPlacement] = useState<Placement>("top");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="触发方式">
					<Segmented<Trigger>
						onChange={setTrigger}
						options={[
							{ label: "悬停", value: "hover" },
							{ label: "点击", value: "click" },
						]}
						value={trigger}
					/>
				</Control>
				<Control label="方位">
					<Segmented<Placement>
						onChange={setPlacement}
						options={PLACEMENTS}
						value={placement}
					/>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						<span>trigger {trigger}</span>
						<span>placement {placement}</span>
					</>
				}
			>
				<Popover
					content={<EvidenceSummary />}
					placement={placement}
					trigger={trigger}
				>
					<Button>查看证据</Button>
				</Popover>
			</Stage>
		</div>
	);
}

function ControlledRow() {
	const [open, setOpen] = useState(false);
	return (
		<TableRow>
			<TableCell className="font-mono text-xs">open · onOpenChange</TableCell>
			<TableCell className="text-fg-secondary">
				调用处管开合（现在{open ? "开着" : "关着"}）
			</TableCell>
			<TableCell className="text-fg-secondary">
				关上时要撤销内容里的预览
			</TableCell>
			<TableCell>
				<Popover
					content={<EvidenceSummary />}
					onOpenChange={setOpen}
					open={open}
					placement="left"
					trigger="click"
				>
					<Button size="small">查看证据</Button>
				</Popover>
			</TableCell>
		</TableRow>
	);
}

function Triggers() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>写法</TableHead>
						<TableHead>开合</TableHead>
						<TableHead>适合</TableHead>
						<TableHead>示例</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{TRIGGERS.map(([trigger, opens, when]) => (
						<TableRow key={trigger}>
							<TableCell className="font-mono text-xs">{trigger}</TableCell>
							<TableCell className="text-fg-secondary">{opens}</TableCell>
							<TableCell className="text-fg-secondary">{when}</TableCell>
							<TableCell>
								<Popover
									content={<EvidenceSummary />}
									placement="left"
									trigger={trigger}
								>
									<Button size="small">查看证据</Button>
								</Popover>
							</TableCell>
						</TableRow>
					))}
					<ControlledRow />
				</TableBody>
			</Table>
		</Block>
	);
}

function ChosenPopover() {
	const [chosen, setChosen] = useState(["候选人 A", "候选人 B", "候选人 C"]);
	return (
		<Popover
			className="max-h-(--available-height) w-64 overflow-y-auto"
			content={
				<>
					<div className="mb-2 font-medium text-base">已选的人</div>
					<ul className="flex flex-col gap-0.5">
						{chosen.map((name) => (
							<li className="flex items-center gap-2 ps-2" key={name}>
								<span className="min-w-0 flex-1 truncate text-base">
									{name}
								</span>
								<ActionIcon
									aria-label={`移除 ${name}`}
									icon={XIcon}
									onClick={() =>
										setChosen((old) => old.filter((one) => one !== name))
									}
									size="small"
								/>
							</li>
						))}
					</ul>
				</>
			}
			placement="bottomLeft"
			popupProps={{ "aria-label": "已选的人" }}
			trigger="click"
		>
			<Button size="small" type="text">
				已选 <b className="tabular-nums">{chosen.length}</b> 人
			</Button>
		</Popover>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="名单底下的工具条上，「已选 N 人」点开是选中的那几个人，每行能移除；贴着按钮左下角展开。"
				title="已选的人"
			>
				<ChosenPopover />
			</Example>
			<Example
				description="一段只读说明挂在按钮上方，悬停看完移开就收。"
				title="条件说明"
			>
				<Popover content="条件之间是「并且」，同一项里的取值是「或者」。">
					<Button type="text">条件怎么组合</Button>
				</Popover>
			</Example>
		</ExampleGrid>
	);
}

export function PopoverPage() {
	return (
		<DocPage
			facts={[`${TRIGGERS.length} 种触发方式`, `${PLACEMENTS.length} 个方位`]}
			rules={{
				notes: [
					"只有一句名字或全文用 Tooltip；要放几行内容、输入或按钮才用 Popover。",
					'里面有输入的气泡用 trigger="click"，悬停打开的气泡只放只读内容。',
					"内容可能很长时给 className 限高到 --available-height，在浮层里滚动。",
					"气泡里的控件同样用 components/ui 的组件，不手写边框、阴影和圆角。",
					"要标题就在 content 里第一行写，气泡本身没有标题位。",
				],
				usage: `<Popover content={<ChosenList />} placement="bottomLeft" trigger="click">\n  <Button>已选 3 人</Button>\n</Popover>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用气泡卡片" },
				{ children: <Triggers />, id: "appearance", title: "外观与状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
