import { ArrowRight, ChevronDown, Download, Plus, Send } from "lucide-react";
import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Button, type ButtonProps } from "#/components/ui/button";
import {
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
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
import { COMPONENT_TIERS } from "../../../shared/tokens/registry";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { SizeCell, SizeReading } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { useTier } from "../../state";

type ButtonType = NonNullable<ButtonProps["type"]>;
type ButtonSize = NonNullable<ButtonProps["size"]>;

/** 外观与状态表的行：类型、示例文字。 */
const APPEARANCES: [type: ButtonType, label: string][] = [
	["primary", "主要操作"],
	["default", "次要操作"],
	["fill", "柔和填充"],
	["text", "轻量操作"],
	["link", "链接样式"],
];

type Content = "text" | "start" | "end";
type State = "default" | "disabled" | "loading";

function Playground() {
	const sizeTier = useTier("button");
	const [label, setLabel] = useState("新建搜索");
	const [type, setType] = useState<ButtonType>("primary");
	const [content, setContent] = useState<Content>("start");
	const [state, setState] = useState<State>("default");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control className="grow" htmlFor="playground-label" label="按钮文字">
					<Input
						id="playground-label"
						onChange={(event) => setLabel(event.target.value)}
						value={label}
						variant="filled"
					/>
				</Control>
				<Control label="外观">
					<Segmented<ButtonType>
						onChange={setType}
						options={[
							{ label: "主要", value: "primary" },
							{ label: "次要", value: "default" },
							{ label: "填充", value: "fill" },
							{ label: "文字", value: "text" },
							{ label: "链接", value: "link" },
						]}
						value={type}
					/>
				</Control>
				<Control label="内容">
					<Segmented<Content>
						onChange={setContent}
						options={[
							{ label: "只有文字", value: "text" },
							{ label: "前置图标", value: "start" },
							{ label: "后置图标", value: "end" },
						]}
						value={content}
					/>
				</Control>
				<Control label="状态">
					<Segmented<State>
						onChange={setState}
						options={[
							{ label: "默认", value: "default" },
							{ label: "禁用", value: "disabled" },
							{ label: "加载中", value: "loading" },
						]}
						value={state}
					/>
				</Control>
			</Controls>
			<Stage footer={<SizeReading group="button" tier={sizeTier} />}>
				<Button
					disabled={state === "disabled"}
					icon={
						content === "text"
							? undefined
							: content === "end"
								? ArrowRight
								: Plus
					}
					iconPosition={content === "end" ? "end" : "start"}
					loading={state === "loading"}
					size={sizeTier}
					type={type}
				>
					{label}
				</Button>
			</Stage>
		</div>
	);
}

function Appearances() {
	const sizeTier = useTier("button");
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>外观</TableHead>
						<TableHead>默认 · 可交互</TableHead>
						<TableHead>禁用</TableHead>
						<TableHead>加载中</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{APPEARANCES.map(([type, label]) => (
						<TableRow key={type}>
							<TableCell className="font-mono text-xs">{type}</TableCell>
							<TableCell>
								<Button size={sizeTier} type={type}>
									{label}
								</Button>
							</TableCell>
							<TableCell>
								<Button disabled size={sizeTier} type={type}>
									{label}
								</Button>
							</TableCell>
							<TableCell>
								<Button loading size={sizeTier} type={type}>
									处理中
								</Button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function SizeRow({ size }: { size: ButtonSize }) {
	const sizeTier = useTier("button");
	return (
		<TableRow data-state={size === sizeTier ? "selected" : undefined}>
			<TableCell>
				<SizeCell group="button" tier={size} />
			</TableCell>
			<TableCell>
				<Button size={size} type="primary">
					新建搜索
				</Button>
			</TableCell>
			<TableCell>
				<Button icon={Plus} size={size} type="primary">
					新建搜索
				</Button>
			</TableCell>
			<TableCell>
				<Button icon={ArrowRight} iconPosition="end" size={size} type="primary">
					下一位
				</Button>
			</TableCell>
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
						<TableHead>文字</TableHead>
						<TableHead>前置图标</TableHead>
						<TableHead>后置图标</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{COMPONENT_TIERS.button.map((size) => (
						<SizeRow key={size} size={size} />
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	const [saving, setSaving] = useState(false);
	const save = () => {
		setSaving(true);
		window.setTimeout(() => setSaving(false), 1200);
	};
	return (
		<ExampleGrid>
			<Example
				description="提交后按钮进入加载态，挡住重复点击，完成后恢复。"
				title="提交与反馈"
			>
				<Button icon={Send} loading={saving} onClick={save} type="primary">
					{saving ? "保存中" : "保存为模板"}
				</Button>
			</Example>
			<Example
				description="打开菜单的按钮带一个向下的箭头。"
				title="弹层触发器"
			>
				<DropdownMenuRoot>
					<DropdownMenuTrigger>
						<Button icon={ChevronDown} iconPosition="end">
							导出名单
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuPortal>
						<DropdownMenuPositioner>
							<DropdownMenuPopup>
								{renderDropdownMenuItems([
									{ key: "csv", label: "导出为 CSV" },
									{ key: "xlsx", label: "导出为 Excel" },
								])}
							</DropdownMenuPopup>
						</DropdownMenuPositioner>
					</DropdownMenuPortal>
				</DropdownMenuRoot>
				<Button icon={Download} type="fill">
					下载简历
				</Button>
			</Example>
			<Example
				description="文字写动作本身；长短不同的两个按钮并排时各按内容取宽。"
				title="文字长度"
			>
				<Button>保存</Button>
				<Button type="primary">保存并开始下一轮搜索</Button>
			</Example>
			<Example
				description="挨着正文的文字按钮用 outdent 抵掉内边距，和上下的字对齐。"
				title="紧凑空间"
			>
				<div className="flex flex-col items-start gap-1 text-sm">
					<span>已选 3 位候选人</span>
					<Button outdent size="small" type="text">
						清空选择
					</Button>
				</div>
			</Example>
		</ExampleGrid>
	);
}

export function ButtonPage() {
	const sizeTier = useTier("button");
	return (
		<DocPage
			facts={[
				`${APPEARANCES.length} 种外观`,
				`${COMPONENT_TIERS.button.length} 种尺寸`,
			]}
			rules={{
				notes: [
					"一次动作用 Button；只有图标的按钮用 ActionIcon。",
					"一组按钮里最多一个 primary；不自己改按钮的颜色。",
					"站内跳转用 render 传路由的 <Link>，不写 href。",
					"尺寸用 size，不覆盖高度、圆角和内边距；宽度属于外层布局。",
					"加载中用 loading，按钮文字可以跟着换成进行时。",
				],
				usage: `<Button icon={Plus} type="primary">\n  新建搜索\n</Button>`,
			}}
			sections={[
				{
					children: <Playground />,
					id: "playground",
					tag: sizeTier,
					title: "试用按钮",
				},
				{
					children: <Appearances />,
					id: "appearance",
					tag: sizeTier,
					title: "外观与状态",
				},
				{ children: <Sizes />, id: "sizes", title: "尺寸" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
