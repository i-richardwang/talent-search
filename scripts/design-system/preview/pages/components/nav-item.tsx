import {
	ActivityIcon,
	MessageSquareTextIcon,
	MoreHorizontalIcon,
	PlusIcon,
	TableIcon,
	TagsIcon,
	TextSearchIcon,
} from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { NavGroup, NavGroups, NavItem } from "#/components/ui/nav-item";
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
import { stay } from "../../kit/stay";

function More({ label }: { label: string }) {
	return (
		<ActionIcon
			aria-label={`「${label}」的更多操作`}
			icon={MoreHorizontalIcon}
			size="small"
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
						actions={actions && <More label={label} />}
						active={active}
						href="#recent"
						icon={MessageSquareTextIcon}
						iconSize="small"
						onClick={stay}
					>
						{label}
					</NavItem>
				</div>
			</Stage>
		</div>
	);
}

const LOOKS: [name: string, note: string, active: boolean, actions: boolean][] =
	[
		["默认", "没有底，悬停出底", false, false],
		["active", "当前所在的一项：有底，图标和字换成正文色", true, false],
		[
			"actions",
			"行尾动作在指针进入这一行、焦点落到动作上或它的菜单开着时出现，标题在它底下渐隐",
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
										actions={actions && <More label="支付风控 / 学校 B" />}
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
	const [open, setOpen] = useState<string[]>(["recent"]);
	const admin = [
		{ icon: TableIcon, key: "data", label: "数据" },
		{ icon: TagsIcon, key: "skills", label: "技能" },
		{ icon: ActivityIcon, key: "tasks", label: "任务" },
	];
	return (
		<ExampleGrid>
			<Example
				description="最近搜索一行一条记录：小图标说是 AI 搜索还是关键词搜索，行尾的「…」画在链接外。列不完时最后一行是「更多」。组名整行可点，收起或展开；组名行尾也有一枚「…」，悬停时出现。"
				title="最近搜索"
			>
				<div className="w-nav bg-layout p-1">
					<NavGroups onValueChange={setOpen} value={open}>
						<NavGroup
							action={<More label="最近搜索" />}
							title="最近搜索"
							value="recent"
						>
							<NavItem
								actions={<More label="找做过支付风控、学校 B 毕业的" />}
								href="#recent-1"
								icon={MessageSquareTextIcon}
								iconSize="small"
								onClick={stay}
							>
								找做过支付风控、学校 B 毕业的
							</NavItem>
							<NavItem
								actions={<More label="推荐系统 · 某甲科技" />}
								href="#recent-2"
								icon={TextSearchIcon}
								iconSize="small"
								onClick={stay}
							>
								推荐系统 · 某甲科技
							</NavItem>
							<NavItem
								icon={MoreHorizontalIcon}
								render={<button type="button" />}
							>
								更多
							</NavItem>
						</NavGroup>
					</NavGroups>
				</div>
			</Example>
			<Example
				description="新搜索单独一项放在最上面；管理页三项不成组，沉在导航栏滚动区的底上，所在的那一页是当前项。"
				title="管理页"
			>
				<div className="flex h-72 w-nav flex-col gap-px bg-layout p-1">
					<NavItem href="#home" icon={PlusIcon} onClick={stay}>
						新搜索
					</NavItem>
					<div aria-hidden className="flex-1" />
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
				</div>
			</Example>
		</ExampleGrid>
	);
}

export function NavItemPage() {
	return (
		<DocPage
			facts={["当前项", "行尾动作", "可收起的分组"]}
			rules={{
				notes: [
					"一项就是一条真链接：render 传路由的 <Link>，中键、右键和键盘照常。",
					"当前所在的一项给 active，不另加选中装饰。",
					"行尾的动作放 actions，画在链接外；链接里不嵌别的动作。平时透明也不接指针，指针进入这一行、键盘焦点落到动作上或它的菜单开着时出现。",
					'不去别处、只打开什么的一行（「更多」）传 render={<button type="button" />}。',
					"标题一行放不下就截断，指针停在被截断的标题上时提示完整的一行。",
					"几项同属一类时用 NavGroup 包起来，几组放进一个 NavGroups：组名整行可点、收起或展开，展开着哪几组（value）由使用方记住；组名行尾的 action 悬停时出现。",
					'一长串同类的记录（最近搜索）给 iconSize="small"；几个固定入口用缺省尺寸。',
				],
				usage: `<NavGroups value={open} onValueChange={setOpen}>\n  <NavGroup value="recent" title="最近搜索" action={menu}>\n    <NavItem icon={TextSearchIcon} iconSize="small" render={<Link to="/s/$turnId" params={params} />}>\n      推荐系统 · 某甲科技\n    </NavItem>\n  </NavGroup>\n</NavGroups>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用导航项" },
				{ children: <Looks />, id: "appearance", title: "状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
