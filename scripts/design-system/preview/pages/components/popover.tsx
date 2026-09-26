import { History, ListFilterIcon } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
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
type Placement = "top" | "bottomLeft" | "bottomRight" | "left";

const PLACEMENTS: { label: string; value: Placement }[] = [
	{ label: "上", value: "top" },
	{ label: "左下", value: "bottomLeft" },
	{ label: "右下", value: "bottomRight" },
	{ label: "左", value: "left" },
];

/** 触发方式表的行：写法、怎么打开、什么时候用。 */
const TRIGGERS: [trigger: Trigger, opens: string, when: string][] = [
	["hover", "悬停打开，移开收起", "只读的补充信息"],
	["click", "点击打开，点外面或 Esc 收起", "里面有输入或按钮"],
];

/** 一条证据的摘要，气泡里的只读内容。 */
function EvidenceSummary() {
	return (
		<div className="flex max-w-(--container-rail) flex-col gap-1.5 text-xs">
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

/** 受控的一行：开合存在这一行里，旁边的文字跟着变。 */
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

/** 筛选：点开一列勾选框，浮层按屏幕剩下的高度限高，超出在里面滚。 */
function FilterPopover() {
	const [chosen, setChosen] = useState<string[]>(["本科"]);
	const options = ["大专", "本科", "硕士", "博士"];
	return (
		<Popover
			className="max-h-(--available-height) w-72 overflow-y-auto"
			content={
				<div className="flex flex-col gap-2">
					<span className="font-medium text-sm">学历</span>
					{options.map((option) => (
						<Checkbox
							checked={chosen.includes(option)}
							key={option}
							onChange={(checked) =>
								setChosen(
									checked
										? [...chosen, option]
										: chosen.filter((one) => one !== option),
								)
							}
						>
							{option}
						</Checkbox>
					))}
				</div>
			}
			placement="bottomLeft"
			trigger="click"
		>
			<Button icon={ListFilterIcon} size="small">
				筛选
				{chosen.length > 0 && (
					<span className="tabular-nums">{chosen.length}</span>
				)}
			</Button>
		</Popover>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="里面有勾选的浮层点击打开，贴着按钮左下角展开。"
				title="筛选"
			>
				<FilterPopover />
			</Example>
			<Example
				description="贴在页面右上角的按钮向右下对齐展开；只有图标的触发器给浮层一个名字。"
				title="最近搜索"
			>
				<Popover
					className="w-80"
					content={
						<div className="flex flex-col gap-2 text-sm">
							<span className="font-medium text-base">最近搜索</span>
							<span className="text-fg-secondary">
								做过搜索召回的后端，3 年以上
							</span>
							<span className="text-fg-secondary">支付风控 · 本科及以上</span>
						</div>
					}
					placement="bottomRight"
					popupProps={{ "aria-label": "最近搜索" }}
					trigger="click"
				>
					<ActionIcon aria-label="最近搜索" icon={History} />
				</Popover>
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

/** 气泡卡片页：试用、触发方式、使用场景。 */
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
				],
				usage: `<Popover content={<FilterList />} placement="bottomLeft" trigger="click">\n  <Button>筛选</Button>\n</Popover>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用气泡卡片" },
				{ children: <Triggers />, id: "appearance", title: "外观与状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
