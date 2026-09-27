import {
	MessageSquareTextIcon,
	PanelLeftOpenIcon,
	PlusIcon,
	UsersRoundIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import {
	AppContent,
	AppHome,
	AppLayout,
	AppNav,
	AppNavDrawer,
	AppNavHeader,
	NavHeader,
	NavHeaderTitle,
} from "#/components/ui/app-layout";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { DraggablePanel } from "#/components/ui/draggable-panel";
import { NavGroup, NavGroups, NavItem } from "#/components/ui/nav-item";
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

type Columns = "one" | "two";

/** 示例里的链接只在页内跳，不离开预览页。 */
const stay = (event: { preventDefault: () => void }) => event.preventDefault();

/** 导航栏里的内容：身份、新搜索和一组最近搜索。 */
function Nav() {
	const [open, setOpen] = useState(["recent"]);
	return (
		<>
			<AppNavHeader
				href="#home"
				logo={UsersRoundIcon}
				name="人才搜索"
				onClick={stay}
			/>
			<div className="flex flex-col px-1">
				<NavItem active href="#home" icon={PlusIcon} onClick={stay}>
					新搜索
				</NavItem>
			</div>
			<NavGroups className="mt-2 px-1" onValueChange={setOpen} value={open}>
				<NavGroup title="最近搜索" value="recent">
					<NavItem
						href="#recent"
						icon={MessageSquareTextIcon}
						iconSize="small"
						onClick={stay}
					>
						做过推荐系统的算法工程师
					</NavItem>
				</NavGroup>
			</NavGroups>
		</>
	);
}

function Playground() {
	const [columns, setColumns] = useState<Columns>("two");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="内容卡片">
					<Segmented<Columns>
						onChange={setColumns}
						options={[
							{ label: "一栏", value: "one" },
							{ label: "两栏", value: "two" },
						]}
						value={columns}
					/>
				</Control>
			</Controls>
			<Stage
				className="items-stretch p-0"
				footer={
					<span>
						导航栏默认 280px、拖动 240–400px，窄于 lg
						不常驻；卡片里每一栏顶上一条 NavHeader
					</span>
				}
			>
				<AppLayout className="h-112">
					<AppNav aria-label="示例导航">
						<Nav />
					</AppNav>
					<AppContent>
						<div className="flex min-h-0 flex-1">
							<div className="flex min-w-0 flex-1 flex-col">
								<NavHeader
									left={<NavHeaderTitle as="h2">名单</NavHeaderTitle>}
									right={<Button size="small">选择</Button>}
								/>
								<p className="px-4 text-fg-secondary text-sm">
									这一栏的内容自己决定滚动。
								</p>
							</div>
							<DraggablePanel
								className="h-full"
								defaultSize={320}
								expand={columns === "two"}
								maxWidth={480}
								minWidth={280}
								showHandleWideArea={false}
							>
								<NavHeader
									left={<NavHeaderTitle as="h2">对话</NavHeaderTitle>}
								/>
								<p className="px-4 text-fg-secondary text-sm">
									并排的一栏可以拖动调宽，边就是和左边之间的竖线。
								</p>
							</DraggablePanel>
						</div>
					</AppContent>
				</AppLayout>
			</Stage>
		</div>
	);
}

/** 页头的几种排法：只有左边、左右两组、中间再占一段。 */
function Headers() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>插槽</TableHead>
						<TableHead className="w-full">NavHeader</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell className="font-mono text-xs">left</TableCell>
						<TableCell>
							<Block padding={0} variant="outlined">
								<NavHeader
									left={<NavHeaderTitle as="h2">任务</NavHeaderTitle>}
								/>
							</Block>
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">left · right</TableCell>
						<TableCell>
							<Block padding={0} variant="outlined">
								<NavHeader
									left={
										<>
											<ActionIcon
												aria-label="打开导航"
												icon={PanelLeftOpenIcon}
												size="header"
												title="打开导航"
											/>
											<NavHeaderTitle as="h2">
												找做过推荐系统的算法工程师
											</NavHeaderTitle>
										</>
									}
									right={<Button size="small">对话</Button>}
								/>
							</Block>
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">
							left · children · right
						</TableCell>
						<TableCell>
							<Block padding={0} variant="outlined">
								<NavHeader
									left={<NavHeaderTitle as="h2">技能</NavHeaderTitle>}
									right={
										<ActionIcon aria-label="关闭" icon={XIcon} size="header" />
									}
								>
									<span className="text-fg-secondary text-sm">
										中间一段占满剩下的宽
									</span>
								</NavHeader>
							</Block>
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="导航栏顶上是身份：主色方块图标加产品名，整行是回首页的链接，悬停出底。"
				title="导航栏的身份"
			>
				<div className="w-nav bg-layout">
					<AppNavHeader
						href="#home"
						logo={UsersRoundIcon}
						name="人才搜索"
						onClick={stay}
					/>
				</div>
			</Example>
			<Example
				description="侧栏的页头和主栏的等高；主栏的标题是这一屏的 h1，侧栏的用 h2。"
				title="侧栏的页头"
			>
				<Block className="w-full" padding={0} variant="outlined">
					<NavHeader left={<NavHeaderTitle as="h2">对话</NavHeaderTitle>} />
				</Block>
			</Example>
			<Example
				description="从左边滑出、和导航栏同一块画布的一栏：layout 底、两侧细线、向右一层很浅的影，顶上一行是标题和关闭钮。窄屏的导航、导航里「更多」打开的全部记录都用它。"
				title="贴左边的抽屉"
			>
				<DrawerDemo />
			</Example>
			<Example
				description="首页那一屏：比卡片暗半档的底，页头浮在顶上；问句和输入面落在中线上，下面接着最近搜索或起步的例子。"
				title="首页"
			>
				<Block
					className="flex h-80 w-full overflow-hidden"
					padding={0}
					variant="outlined"
				>
					<AppHome
						header={<NavHeader />}
						input={
							<Block className="h-24" variant="outlined">
								<span className="text-fg-tertiary text-sm">输入面</span>
							</Block>
						}
						title="想找什么样的人？"
					>
						<p className="m-0 text-fg-tertiary text-sm">下面接着的内容</p>
					</AppHome>
				</Block>
			</Example>
		</ExampleGrid>
	);
}

function DrawerDemo() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button onClick={() => setOpen(true)}>打开抽屉</Button>
			<AppNavDrawer
				onClose={() => setOpen(false)}
				open={open}
				title="全部搜索记录"
			>
				<div className="flex flex-col gap-px px-1">
					<NavItem
						href="#recent"
						icon={MessageSquareTextIcon}
						iconSize="small"
						onClick={stay}
					>
						做过推荐系统的算法工程师
					</NavItem>
				</div>
			</AppNavDrawer>
		</>
	);
}

/** 应用外壳页：试用、页头的排法、使用场景。 */
export function AppLayoutPage() {
	return (
		<DocPage
			facts={["导航栏与内容卡片", "页头三个插槽", "贴左边的抽屉", "首页"]}
			rules={{
				notes: [
					"每一屏都画在 AppContent 的卡片里（描边、8px 圆角）；导航栏落在画布上，不描边。",
					"导航栏 lg 以上常驻，右边缘拖动调宽（240–400px，默认 280px），可以收起到 0 宽；lg 以下不渲染，同一份内容由使用方放进左边的抽屉。",
					"收起导航栏的开关放在 AppNavHeader 的 toggle 里，平时 0 宽，指针进入导航栏才展开到 32px；导航栏收起后开关挪到主栏页头的左端，卡片左边也内缩 8px。",
					"卡片自己不滚动：卡片里的每一栏各自决定滚动归谁。",
					"每一栏顶上一条 NavHeader，高度读 --nav-header-height；标题用 NavHeaderTitle，主栏是 h1，侧栏是 h2。",
					"并排的侧栏用 DraggablePanel，它的边就是两栏之间的竖线，不另画面。",
					"从左边滑出的一栏用 AppNavDrawer：和导航栏同一块画布，给 title 时顶上一行是标题和关闭钮；不给时由内容自己出头部（窄屏的导航：导航栏顶上那一行里收起开关那一格换成关闭钮）。",
					"首页那一屏用 AppHome：页头浮在顶上不占高，问句（22px 半粗、最多两行）和输入面落在中线上，下面的内容高过一半时输入面往上让。",
				],
				usage: `<AppLayout>\n  <AppNav aria-label="导航">\n    <AppNavHeader logo={UsersRoundIcon} name="人才搜索" render={<Link to="/" />} />\n  </AppNav>\n  <AppContent>\n    <NavHeader left={<NavHeaderTitle>任务</NavHeaderTitle>} />\n  </AppContent>\n</AppLayout>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用应用外壳" },
				{ children: <Headers />, id: "appearance", title: "页头的排法" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
