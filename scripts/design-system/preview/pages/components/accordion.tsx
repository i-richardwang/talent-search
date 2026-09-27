import {
	ActivityIcon,
	CheckIcon,
	MessageSquareTextIcon,
	MoreHorizontalIcon,
	TableIcon,
	TagsIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	Accordion,
	AccordionAction,
	AccordionHeader,
	type AccordionIndicatorPlacement,
	AccordionItem,
	AccordionPanel,
	AccordionRoot,
	AccordionTrigger,
	type AccordionVariant,
} from "#/components/ui/accordion";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Icon } from "#/components/ui/icon";
import { NavItem } from "#/components/ui/nav-item";
import { Segmented } from "#/components/ui/segmented";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

const VARIANTS: AccordionVariant[] = ["borderless", "filled", "outlined"];
const PLACEMENTS: AccordionIndicatorPlacement[] = ["start", "end", "inline"];

const ITEMS = [
	{
		children:
			"按「累计 5 年以上」理解年限，不是单段。人才库里没有「带过团队」这一项，这条没有写进搜索条件。",
		key: "notes",
		title: "这一轮的说明",
	},
	{
		children: "推荐系统、搜索排序两项经历都要有，同一个人身上。",
		key: "conditions",
		title: "搜索条件",
	},
	{
		children: "学校、学历、职级三维没有限定。",
		disabled: true,
		key: "rest",
		title: "其余几维",
	},
];

/** 示例里的链接只在页内跳，不离开预览页。 */
const stay = (event: { preventDefault: () => void }) => event.preventDefault();

function Playground() {
	const [variant, setVariant] = useState<AccordionVariant>("borderless");
	const [placement, setPlacement] =
		useState<AccordionIndicatorPlacement>("start");
	const [action, setAction] = useState(false);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="面">
					<Segmented<AccordionVariant>
						onChange={setVariant}
						options={VARIANTS}
						value={variant}
					/>
				</Control>
				<Control label="箭头">
					<Segmented<AccordionIndicatorPlacement>
						onChange={setPlacement}
						options={PLACEMENTS}
						value={placement}
					/>
				</Control>
				<Control>
					<Checkbox checked={action} onChange={setAction}>
						行尾动作
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				className="justify-start"
				footer={
					<span className="font-mono">
						{variant} · {placement}
					</span>
				}
			>
				<div className="w-full max-w-md px-2">
					<Accordion
						defaultValue={["notes"]}
						indicatorPlacement={placement}
						items={ITEMS.map((item) => ({
							...item,
							action: action && (
								<ActionIcon
									icon={MoreHorizontalIcon}
									size="small"
									title="更多"
								/>
							),
						}))}
						variant={variant}
					/>
				</div>
			</Stage>
		</div>
	);
}

const RECENT = [
	"找做过推荐系统的算法工程师",
	"搜索排序，五年以上",
	"数据平台负责人",
];

const ADMIN = [
	{ icon: TableIcon, text: "数据" },
	{ icon: TagsIcon, text: "技能" },
	{ icon: ActivityIcon, text: "任务" },
];

/**
 * 侧栏的分组：组名 12px 中粗次要色，三角紧跟在字后；整行悬停铺底，行尾「…」悬停才出现。
 * 组与组之间 8px。
 */
function SidebarGroups() {
	const [open, setOpen] = useState(["recent", "admin"]);
	const group = (key: string, title: string, rows: ReactNode) => (
		<AccordionItem value={key}>
			<AccordionHeader>
				<AccordionTrigger className="py-1 ps-2 pe-1">
					<span className="truncate font-medium text-fg-secondary text-xs">
						{title}
					</span>
				</AccordionTrigger>
				<AccordionAction>
					<ActionIcon icon={MoreHorizontalIcon} size="small" title="更多" />
				</AccordionAction>
			</AccordionHeader>
			<AccordionPanel>
				<div className="flex flex-col gap-px">{rows}</div>
			</AccordionPanel>
		</AccordionItem>
	);
	return (
		<div className="w-nav bg-layout px-1 py-2">
			<AccordionRoot
				className="gap-2"
				indicatorPlacement="inline"
				onValueChange={setOpen}
				value={open}
			>
				{group(
					"recent",
					"最近搜索",
					RECENT.map((text) => (
						<NavItem
							href="#recent"
							icon={MessageSquareTextIcon}
							iconSize="small"
							key={text}
							onClick={stay}
						>
							{text}
						</NavItem>
					)),
				)}
				{group(
					"admin",
					"管理",
					ADMIN.map(({ icon, text }) => (
						<NavItem href="#admin" icon={icon} key={text} onClick={stay}>
							{text}
						</NavItem>
					)),
				)}
			</AccordionRoot>
		</div>
	);
}

const STEPS = [
	"查词：推荐系统 → 标准词 1 个",
	"预搜「推荐系统」：42 人",
	"预搜「推荐系统 + 搜索排序」：17 人",
];

/** 一段过程收成一行摘要：状态格、结论、紧跟的三角；展开是每一步一行，字降一档。 */
function ProcessSummary() {
	return (
		<div className="w-full">
			<Accordion
				classNames={{ trigger: "gap-1.5 p-1 text-fg-secondary" }}
				indicatorPlacement="inline"
				items={[
					{
						children: (
							<ol className="flex flex-col gap-1 ps-8.5 pt-1 pb-3 text-fg-secondary text-xs tabular-nums">
								{STEPS.map((step) => (
									<li key={step}>{step}</li>
								))}
							</ol>
						),
						key: "process",
						title: (
							<>
								<Block
									align="center"
									className="shrink-0"
									height={24}
									horizontal
									justify="center"
									variant="outlined"
									width={24}
								>
									<Icon
										aria-hidden="true"
										className="text-success"
										icon={CheckIcon}
										size={12}
									/>
								</Block>
								<span>检索过程</span>
							</>
						),
					},
				]}
			/>
		</div>
	);
}

/** 展开的是哪几项由外面决定：外面的按钮与行上的开关改的是同一份状态。 */
function Controlled() {
	const [open, setOpen] = useState<string[]>([]);
	const all = ITEMS.filter((item) => !item.disabled).map((item) => item.key);
	return (
		<div className="flex w-full flex-col items-start gap-3">
			<Button
				onClick={() => setOpen(open.length === all.length ? [] : all)}
				size="small"
			>
				{open.length === all.length ? "全部收起" : "全部展开"}
			</Button>
			<div className="w-full">
				<Accordion
					indicatorPlacement="end"
					items={ITEMS}
					onValueChange={setOpen}
					value={open}
					variant="outlined"
				/>
			</div>
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="左侧导航里一组一组的记录：组名能收起，行尾的动作悬停才出现，平时只剩组名。"
				title="侧栏分组"
			>
				<SidebarGroups />
			</Example>
			<Example
				description="一段过程收成一行摘要，想核对的人点开看每一步。"
				title="收起过程"
			>
				<ProcessSummary />
			</Example>
			<Example
				description="value 受控时，外面的动作和行上的开关改同一份状态。"
				title="受控展开"
			>
				<Controlled />
			</Example>
		</ExampleGrid>
	);
}

/** 手风琴页：三种面、三种箭头放法，侧栏分组、收起过程与受控三处用法。 */
export function AccordionPage() {
	return (
		<DocPage
			facts={[
				`${VARIANTS.length} 种面`,
				`${PLACEMENTS.length} 种箭头放法`,
				"默认可同时展开多项",
			]}
			rules={{
				notes: [
					"一行标题管一块内容的开合用 Accordion；整组一次画完传 items，行上要套别的东西时用 AccordionRoot、AccordionItem、AccordionHeader、AccordionTrigger、AccordionPanel 拼。",
					"箭头 start 放在字前、内容缩进；end 放在行尾；inline 是紧跟在字后的小三角，用在侧栏组名和过程摘要这类次要的行上。",
					"行尾的动作放进 AccordionAction：悬停或焦点落进行里才出现，没有悬停的设备上常显；要一直看得见时给 alwaysVisible。",
					"展开状态用 value 受控或 defaultValue 自管，值是各项 value 的数组。",
					"收起时内容默认卸载，里面不放要保住的输入状态；要保住时给 keepMounted。",
					"高度和淡入的过渡由组件给，不另加动效。",
				],
				usage: `<Accordion\n  indicatorPlacement="inline"\n  items={[{ key: "process", title: "检索过程", children: steps }]}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用手风琴" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
