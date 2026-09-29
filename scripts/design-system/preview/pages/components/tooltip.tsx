import { Download, PanelLeftClose, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
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
import { Tag } from "#/components/ui/tag";
import { Tooltip, type TooltipProps } from "#/components/ui/tooltip";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

const FORMS: [
	name: string,
	label: string,
	props: { title?: string; hotkey?: string; placement?: Placement },
][] = [
	["title", "只有文字", { title: "导出名单" }],
	[
		"title · 长文字",
		"多行",
		{ title: "只统计登记过的经历，简历自述里写的年限不算在内" },
	],
	["title · hotkey", "文字加快捷键", { hotkey: "mod+k", title: "新搜索" }],
	["hotkey", "只有快捷键", { hotkey: "mod+enter" }],
	['placement="bottom"', "在下方", { placement: "bottom", title: "收起导航" }],
];

type Placement = NonNullable<TooltipProps["placement"]>;

const PLACEMENTS: { label: string; value: Placement }[] = [
	{ label: "上", value: "top" },
	{ label: "下", value: "bottom" },
];

function Playground() {
	const [title, setTitle] = useState("导出名单");
	const [hotkey, setHotkey] = useState("mod+e");
	const [placement, setPlacement] = useState<Placement>("top");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control
					className="grow"
					htmlFor="playground-tooltip-title"
					label="提示文字"
				>
					<Input
						id="playground-tooltip-title"
						onChange={(event) => setTitle(event.target.value)}
						value={title}
					/>
				</Control>
				<Control
					className="w-40"
					htmlFor="playground-tooltip-hotkey"
					label="快捷键"
				>
					<Input
						className="font-mono"
						id="playground-tooltip-hotkey"
						onChange={(event) => setHotkey(event.target.value)}
						value={hotkey}
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
						<span>placement {placement}</span>
						<span>悬停或聚焦稍等片刻后出现</span>
					</>
				}
			>
				<Tooltip
					hotkey={hotkey.trim() || undefined}
					placement={placement}
					title={title}
				>
					<Button icon={Download}>导出</Button>
				</Tooltip>
			</Stage>
		</div>
	);
}

function Forms() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>写法</TableHead>
						<TableHead>形态</TableHead>
						<TableHead>悬停查看</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{FORMS.map(([name, label, props]) => (
						<TableRow key={name}>
							<TableCell className="font-mono text-xs">{name}</TableCell>
							<TableCell className="text-fg-secondary">{label}</TableCell>
							<TableCell>
								<Tooltip {...props}>
									<Button size="small">{label}</Button>
								</Tooltip>
							</TableCell>
						</TableRow>
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
				description="只有图标的按钮用 ActionIcon 的 title，提示补上按钮的名字。"
				title="图标按钮"
			>
				<ActionIcon icon={Download} title="导出名单" />
				<ActionIcon icon={Share2} title="复制搜索链接" />
				<ActionIcon icon={Trash2} title="删除这次搜索" />
			</Example>
			<Example
				description="页头上开合导航的按钮：提示在下方，文字后面跟着快捷键。"
				title="带快捷键的图标按钮"
			>
				<ActionIcon
					icon={PanelLeftClose}
					size="header"
					title="收起导航"
					tooltipProps={{ hotkey: "mod+b", placement: "bottom" }}
				/>
			</Example>
			<Example
				description="被截断的部门路径在提示里给出全文，不另开弹层。"
				title="截断的文字"
			>
				<Tooltip title="技术中心 / 平台研发部 / 搜索与推荐组">
					<Tag className="max-w-40">
						<span className="truncate">
							技术中心 / 平台研发部 / 搜索与推荐组
						</span>
					</Tag>
				</Tooltip>
			</Example>
		</ExampleGrid>
	);
}

export function TooltipPage() {
	return (
		<DocPage
			facts={["默认在上方", "可带快捷键", "悬停或聚焦稍等后出现"]}
			rules={{
				notes: [
					"只有图标的按钮用 ActionIcon，它的 title 就是这里的提示，不外包一层 Tooltip。",
					"提示只补一句名字或全文，不放按钮和链接；要交互的内容用 Popover。",
					"文字用产品用词，从 HR 的角度说动作本身。",
					"有快捷键的动作把键写进 hotkey，不写进文字（不写「关闭（Esc）」）；图标按钮经 tooltipProps 传。",
					'默认在上方；贴着页头顶边的按钮用 placement="bottom"，免得提示被窗口边切掉。',
				],
				usage: `<Tooltip hotkey="mod+e" title="导出名单">\n  <Button icon={Download}>导出</Button>\n</Tooltip>\n\n<ActionIcon\n  icon={PanelLeftClose}\n  title="收起导航"\n  tooltipProps={{ hotkey: "mod+b", placement: "bottom" }}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用文字提示" },
				{ children: <Forms />, id: "appearance", title: "外观与状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
