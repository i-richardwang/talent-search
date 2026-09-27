import {
	ActivityIcon,
	MessageSquareTextIcon,
	PlusIcon,
	TableIcon,
	TagsIcon,
	TextSearchIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { NavGroup, NavItem } from "#/components/ui/nav-item";
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

/** 示例里的链接只在页内跳，不离开预览页。 */
const stay = (event: { preventDefault: () => void }) => event.preventDefault();

/** 行尾的删除钮：示例里按下去什么也不删。 */
function Remove({ label }: { label: string }) {
	return (
		<ActionIcon
			aria-label={`删除「${label}」`}
			icon={XIcon}
			size="small"
			title="删除"
		/>
	);
}

function Playground() {
	const [active, setActive] = useState(true);
	const [actions, setActions] = useState(true);
	const label = "找做过推荐系统的算法工程师，最好在大厂待过三年以上";
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={active} onChange={setActive}>
						当前项
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={actions} onChange={setActions}>
						行尾动作
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<span className="font-mono">
						{[active && "active", actions && "actions"]
							.filter(Boolean)
							.join(" · ") || "默认"}
					</span>
				}
			>
				<div className="w-nav bg-layout px-1 py-2">
					<NavItem
						actions={actions && <Remove label={label} />}
						active={active}
						href="#recent"
						icon={MessageSquareTextIcon}
						onClick={stay}
						title={label}
					>
						{label}
					</NavItem>
				</div>
			</Stage>
		</div>
	);
}

/** 一项的几种样子。 */
const LOOKS: [name: string, note: string, active: boolean, actions: boolean][] =
	[
		["默认", "没有底，悬停出底", false, false],
		["active", "当前所在的一项：有底，图标和字换成正文色", true, false],
		[
			"actions",
			"行尾动作悬停或焦点落在行内时出现，标题在它底下渐隐",
			false,
			true,
		],
	];

function Looks() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>状态</TableHead>
						<TableHead>导航项</TableHead>
						<TableHead>说明</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{LOOKS.map(([name, note, active, actions]) => (
						<TableRow key={name}>
							<TableCell className="font-mono text-xs">{name}</TableCell>
							<TableCell>
								<div className="w-nav bg-layout p-1">
									<NavItem
										actions={actions && <Remove label="支付风控 / 学校 B" />}
										active={active}
										href="#item"
										icon={TextSearchIcon}
										onClick={stay}
									>
										支付风控 / 学校 B
									</NavItem>
								</div>
							</TableCell>
							<TableCell className="text-fg-secondary text-xs">
								{note}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	const [current, setCurrent] = useState("tasks");
	const admin = [
		{ icon: TableIcon, key: "data", label: "数据" },
		{ icon: TagsIcon, key: "skills", label: "技能" },
		{ icon: ActivityIcon, key: "tasks", label: "任务" },
	];
	return (
		<ExampleGrid>
			<Example
				description="最近搜索一行一条记录：图标说是 AI 搜索还是关键词搜索，行尾的删除画在链接外，链接里不嵌别的动作。"
				title="最近搜索"
			>
				<div className="w-nav bg-layout p-1">
					<NavGroup title="最近搜索">
						<NavItem
							actions={<Remove label="找做过支付风控、学校 B 毕业的" />}
							href="#recent-1"
							icon={MessageSquareTextIcon}
							onClick={stay}
						>
							找做过支付风控、学校 B 毕业的
						</NavItem>
						<NavItem
							actions={<Remove label="推荐系统 / 某甲科技" />}
							href="#recent-2"
							icon={TextSearchIcon}
							onClick={stay}
						>
							推荐系统 / 某甲科技
						</NavItem>
					</NavGroup>
				</div>
			</Example>
			<Example
				description="管理页一组三项，所在的那一页是当前项；新搜索单独一项放在最上面。"
				title="管理页"
			>
				<div className="flex w-nav flex-col gap-2 bg-layout p-1">
					<NavItem href="#home" icon={PlusIcon} onClick={stay}>
						新搜索
					</NavItem>
					<NavGroup title="管理">
						{admin.map((item) => (
							<NavItem
								active={item.key === current}
								href={`#${item.key}`}
								icon={item.icon}
								key={item.key}
								onClick={(event) => {
									event.preventDefault();
									setCurrent(item.key);
								}}
							>
								{item.label}
							</NavItem>
						))}
					</NavGroup>
				</div>
			</Example>
		</ExampleGrid>
	);
}

/** 导航项页：试用、状态、使用场景。 */
export function NavItemPage() {
	return (
		<DocPage
			facts={["当前项", "行尾动作", "分组"]}
			rules={{
				notes: [
					"一项就是一条真链接：render 传路由的 <Link>，中键、右键和键盘照常。",
					"当前所在的一项给 active，不另加选中装饰。",
					"行尾的动作放 actions，画在链接外；链接里不嵌别的动作。",
					"标题一行放不下就截断，完整的写进 title。",
					"几项同属一类时用 NavGroup 包起来，组名在上。",
				],
				usage: `<NavGroup title="管理">\n  <NavItem active={on("/tasks")} icon={ActivityIcon} render={<Link to="/tasks" />}>\n    任务\n  </NavItem>\n</NavGroup>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用导航项" },
				{ children: <Looks />, id: "appearance", title: "状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
