import {
	ActivityIcon,
	ExternalLinkIcon,
	type LucideIcon,
	PanelLeftOpenIcon,
	TableIcon,
	TagsIcon,
} from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { CopyButton } from "#/components/ui/copy-button";
import { Drawer } from "#/components/ui/drawer";
import { NavItem } from "#/components/ui/nav-item";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Tag } from "#/components/ui/tag";
import { Control, Controls } from "../../kit/controls";
import { OverlayRow } from "../../kit/overlay-row";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { useMotionCommands } from "../../motion";
import { useTokenNumber } from "../../state";

/** 一位合成候选人的几段经历，抽屉正文用。 */
const EXPERIENCES: [period: string, role: string, detail: string][] = [
	[
		"2022-03 至今",
		"后端开发",
		"负责搜索召回服务，把排序链路从离线批量改成实时。",
	],
	[
		"2019-07 至 2022-02",
		"后端开发",
		"维护订单系统的对账任务，做过分库分表迁移。",
	],
	[
		"2017-07 至 2019-06",
		"测试开发",
		"搭了接口自动化测试平台，覆盖主要交易链路。",
	],
];

function CandidateBody() {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap gap-2">
				<Tag>Go 并发调度</Tag>
				<Tag>搜索召回</Tag>
				<Tag>本科</Tag>
			</div>
			{EXPERIENCES.map(([period, role, detail]) => (
				<div className="flex flex-col gap-1 text-sm" key={period}>
					<span className="font-medium">{role}</span>
					<span className="text-fg-tertiary text-xs tabular-nums">
						{period}
					</span>
					<span className="text-fg-secondary leading-6">{detail}</span>
				</div>
			))}
		</div>
	);
}

function HeaderActions() {
	return (
		<>
			<CopyButton content="E0012345" size="header" title="复制工号" />
			<ActionIcon icon={ExternalLinkIcon} size="header" title="在新页打开" />
		</>
	);
}

type Placement = "left" | "right";

const PLACEMENTS: { label: string; value: Placement }[] = [
	{ label: "右", value: "right" },
	{ label: "左", value: "left" },
];

/** 试用：外壳工具条的打开、关闭、重播作用在这里的抽屉上。 */
function Playground() {
	const [open, setOpen] = useState(false);
	const afterClose = useMotionCommands(open, setOpen);
	const read = useTokenNumber();
	const [placement, setPlacement] = useState<Placement>("right");
	const [header, setHeader] = useState(true);
	const [extra, setExtra] = useState(false);
	const close = () => setOpen(false);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="方位">
					<Segmented<Placement>
						onChange={setPlacement}
						options={PLACEMENTS}
						value={placement}
					/>
				</Control>
				<Control>
					<Checkbox checked={header} onChange={setHeader}>
						头部
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={extra} onChange={setExtra}>
						头部动作
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						<span>placement {placement}</span>
						<span>进场 {read("--duration-drawer-enter")} ms</span>
						<span>退场 {read("--duration-drawer-exit")} ms</span>
					</>
				}
			>
				<Button onClick={() => setOpen(true)} type="primary">
					打开抽屉
				</Button>
				<Drawer
					afterClose={afterClose}
					extra={extra ? <HeaderActions /> : undefined}
					noHeader={!header}
					onClose={close}
					open={open}
					placement={placement}
					title="候选人 A"
				>
					<CandidateBody />
				</Drawer>
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
						<TableHead>示例</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<OverlayRow
						code="title"
						label="标题与关闭按钮"
						render={(open, close) => (
							<Drawer onClose={close} open={open} title="候选人 A">
								<CandidateBody />
							</Drawer>
						)}
					/>
					<OverlayRow
						code="noHeader"
						label="没有头部，关闭按钮浮在角上"
						render={(open, close) => (
							<Drawer noHeader onClose={close} open={open}>
								<CandidateBody />
							</Drawer>
						)}
					/>
					<OverlayRow
						code="extra"
						label="头部动作排在关闭按钮左边"
						render={(open, close) => (
							<Drawer
								extra={<HeaderActions />}
								onClose={close}
								open={open}
								title="候选人 A"
							>
								<CandidateBody />
							</Drawer>
						)}
					/>
					<OverlayRow
						code="width"
						label="加宽到宽屏右栏的宽度"
						render={(open, close) => (
							<Drawer
								onClose={close}
								open={open}
								title="候选人 A"
								width="var(--container-detail-wide)"
							>
								<CandidateBody />
							</Drawer>
						)}
					/>
					<OverlayRow
						code="width min()"
						label="按视口收窄：min(92vw, 520px)"
						render={(open, close) => (
							<Drawer
								onClose={close}
								open={open}
								title="候选人 A"
								width="min(92vw, 520px)"
							>
								<CandidateBody />
							</Drawer>
						)}
					/>
				</TableBody>
			</Table>
		</Block>
	);
}

/** 候选人详情：滑出之后才回到名单，回到哪里由 afterClose 决定。 */
function DetailDrawer() {
	const [open, setOpen] = useState(false);
	const [back, setBack] = useState(false);
	return (
		<>
			<Button
				onClick={() => {
					setBack(false);
					setOpen(true);
				}}
				type="text"
			>
				候选人 A
			</Button>
			{back && <span className="text-fg-tertiary text-xs">已回到名单</span>}
			<Drawer
				afterClose={() => setBack(true)}
				onClose={() => setOpen(false)}
				open={open}
				title="候选人 A"
			>
				<CandidateBody />
			</Drawer>
		</>
	);
}

const NAV: [label: string, icon: LucideIcon][] = [
	["数据", TableIcon],
	["技能", TagsIcon],
	["任务", ActivityIcon],
];

function NavigationDrawer() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<ActionIcon
				aria-label="打开导航"
				icon={PanelLeftOpenIcon}
				onClick={() => setOpen(true)}
			/>
			<Drawer
				noHeader
				onClose={() => setOpen(false)}
				open={open}
				placement="left"
				width="var(--container-nav)"
			>
				<nav aria-label="导航" className="flex flex-col px-1 pt-8">
					{NAV.map(([label, icon]) => (
						<NavItem
							href={`#${label}`}
							icon={icon}
							key={label}
							onClick={(event) => {
								event.preventDefault();
								setOpen(false);
							}}
						>
							{label}
						</NavItem>
					))}
				</nav>
			</Drawer>
		</>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="看一位候选人是一次阅读，用抽屉；需要两侧反复对照时才用并列栏。滑出之后再离开，用 afterClose。"
				title="一次阅读"
			>
				<DetailDrawer />
			</Example>
			<Example
				description="窄屏放不下侧栏时，导航收进左边的抽屉，没有标题就不要头部。"
				title="窄屏导航"
			>
				<NavigationDrawer />
			</Example>
		</ExampleGrid>
	);
}

export function DrawerPage() {
	return (
		<DocPage
			facts={[`${PLACEMENTS.length} 个方位`, "可不带头部", "头部动作"]}
			rules={{
				notes: [
					"一次阅读用 Drawer，两侧反复对照才用并列栏。",
					"抽屉挂在打开它的组件里，用受控的 open，关闭走 onClose；滑出之后要做的事放 afterClose。",
					"尺寸用 width，不覆盖面板的圆角、内边距和投影；要跟着视口收窄就写 min(…)。",
					"标题旁的动作放 extra，排在关闭按钮左边。",
				],
				usage: `<Drawer\n  onClose={() => setOpen(false)}\n  open={open}\n  title="候选人 A"\n>\n  …\n</Drawer>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用抽屉" },
				{ children: <Forms />, id: "appearance", title: "外观与状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
