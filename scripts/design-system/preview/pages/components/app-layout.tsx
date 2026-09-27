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
	AppLayout,
	AppNav,
	AppNavHeader,
	NavHeader,
	NavHeaderTitle,
} from "#/components/ui/app-layout";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { NavGroup, NavItem } from "#/components/ui/nav-item";
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
			<div className="mt-2 px-1">
				<NavGroup title="最近搜索">
					<NavItem href="#recent" icon={MessageSquareTextIcon} onClick={stay}>
						做过推荐系统的算法工程师
					</NavItem>
				</NavGroup>
			</div>
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
						导航栏宽 --container-nav，窄于 lg 不常驻；卡片里每一栏顶上一条
						NavHeader
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
							{columns === "two" && (
								<div className="flex w-detail flex-col border-l">
									<NavHeader
										left={<NavHeaderTitle as="h2">对话</NavHeaderTitle>}
									/>
									<p className="px-4 text-fg-secondary text-sm">
										并排的一栏用一根竖线和左边分开。
									</p>
								</div>
							)}
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
		</ExampleGrid>
	);
}

/** 应用外壳页：试用、页头的排法、使用场景。 */
export function AppLayoutPage() {
	return (
		<DocPage
			facts={["导航栏与内容卡片", "页头三个插槽"]}
			rules={{
				notes: [
					"每一屏都画在 AppContent 的卡片里；导航栏落在画布上，不描边。",
					"导航栏 lg 以上常驻，lg 以下不渲染，同一份内容由使用方放进左边的抽屉。",
					"卡片自己不滚动：卡片里的每一栏各自决定滚动归谁。",
					"每一栏顶上一条 NavHeader，高度读 --nav-header-height；标题用 NavHeaderTitle，主栏是 h1，侧栏是 h2。",
					"并排的栏之间用一根竖线分开，不另画面。",
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
