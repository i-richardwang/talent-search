import { TagIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Avatar } from "#/components/ui/avatar";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { Icon } from "#/components/ui/icon";
import {
	List,
	ListItem,
	ListView,
	ListViewHeader,
	ListViewLink,
	ListViewRow,
} from "#/components/ui/list";
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

/** 行尾的移除钮：示例里按下去什么也不删。 */
function Remove({ name }: { name: string }) {
	return <ActionIcon aria-label={`移除 ${name}`} icon={XIcon} size="small" />;
}

function Playground() {
	const [avatar, setAvatar] = useState(true);
	const [description, setDescription] = useState(true);
	const [extra, setExtra] = useState(true);
	const [actions, setActions] = useState(true);
	const [link, setLink] = useState(true);
	const [active, setActive] = useState(false);
	const toggles: [string, boolean, (on: boolean) => void][] = [
		["头像", avatar, setAvatar],
		["说明", description, setDescription],
		["行尾小字", extra, setExtra],
		["行尾动作", actions, setActions],
		["整行链接", link, setLink],
		["当前项", active, setActive],
	];
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				{toggles.map(([label, on, set]) => (
					<Control key={label}>
						<Checkbox checked={on} onChange={set}>
							{label}
						</Checkbox>
					</Control>
				))}
			</Controls>
			<Stage
				footer={
					<span>
						{link ? "整行是一条链接，悬停出底" : "静态的一行，没有悬停"}
						{actions && "；行尾动作悬停或聚焦时出现"}
					</span>
				}
			>
				<List className="w-full max-w-sm">
					{["林小雨", "欧阳明远"].map((name, index) => (
						<ListItem
							actions={actions && <Remove name={name} />}
							active={active && index === 0}
							avatar={avatar && <Avatar size={32} title={name} />}
							description={
								description &&
								(index === 0
									? "高级算法工程师 · 推荐算法部"
									: "数据工程师 · 数据平台部")
							}
							extra={extra && (index === 0 ? "3 条证据" : "1 条证据")}
							href={link ? `#person-${index}` : undefined}
							key={name}
							onClick={stay}
							title={name}
						/>
					))}
				</List>
			</Stage>
		</div>
	);
}

/** 一项的几种样子。 */
const LOOKS: [
	name: string,
	note: string,
	props: { active?: boolean; link?: boolean; showAction?: boolean },
][] = [
	["静态", "没有链接：没有悬停、没有手形", {}],
	["链接", "整行是一条链接：悬停出 fill-tertiary 的底", { link: true }],
	[
		"active",
		"当前项：fill-secondary 的底，悬停加深一档",
		{ active: true, link: true },
	],
	["showAction", "行尾动作一直显示，行尾小字隐去", { showAction: true }],
];

function Looks() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>状态</TableHead>
						<TableHead>一项</TableHead>
						<TableHead>说明</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{LOOKS.map(([name, note, { active, link, showAction }]) => (
						<TableRow key={name}>
							<TableCell className="font-mono text-xs">{name}</TableCell>
							<TableCell className="min-w-64">
								<List className="p-0">
									<ListItem
										actions={<Remove name="林小雨" />}
										active={active}
										avatar={<Avatar size={32} title="林小雨" />}
										description="高级算法工程师"
										extra="3 条证据"
										href={link ? "#look" : undefined}
										onClick={stay}
										showAction={showAction}
										title="林小雨"
									/>
								</List>
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

/** 可多选的列表视图：描边的面、吸顶的表头、分隔线隔开的行；勾上、当前项、悬停三种底。 */
function ListViewExample() {
	const people = [
		{ name: "林小雨", role: "高级算法工程师 · 推荐算法部" },
		{ name: "欧阳明远", role: "数据工程师 · 数据平台部" },
		{ name: "陈一", role: "后端工程师 · 交易平台部" },
	];
	const [picked, setPicked] = useState<string[]>(["欧阳明远"]);
	return (
		<Stage
			className="items-stretch"
			footer={<span>第一行是当前项，勾上的一行换成主色一侧最浅的底</span>}
		>
			<ListView className="w-full">
				<ListViewHeader pick={<Checkbox aria-label="全选" size={18} />}>
					3 人 · 按匹配度排序
				</ListViewHeader>
				{people.map((one, index) => (
					<ListViewRow
						current={index === 0}
						key={one.name}
						pick={
							<Checkbox
								aria-label={`选择 ${one.name}`}
								checked={picked.includes(one.name)}
								className="border-border"
								onChange={(on) =>
									setPicked((old) =>
										on ? [...old, one.name] : old.filter((n) => n !== one.name),
									)
								}
								size={18}
							/>
						}
					>
						<div className="flex items-baseline gap-2">
							<ListViewLink
								className="font-medium text-sm"
								href={`#person-${index}`}
								onClick={stay}
							>
								{one.name}
							</ListViewLink>
							<span className="text-fg-secondary text-xs">{one.role}</span>
						</div>
					</ListViewRow>
				))}
			</ListView>
		</Stage>
	);
}

function Usage() {
	const picked = [
		{ name: "林小雨", onList: true },
		{ name: "欧阳明远", onList: false },
		{ name: "陈一", onList: true },
	];
	const children = [
		{ people: 128, word: "推荐系统" },
		{ people: 46, word: "召回" },
		{ people: 31, word: "排序模型" },
	];
	return (
		<ExampleGrid>
			<Example
				description="浮层里已选的人：静态的一行，行尾「不在名单上」是小字，悬停时换成移除钮。"
				title="已选的人"
			>
				<Block className="w-64" padding={4} shadow variant="outlined">
					<List className="p-0">
						{picked.map((one) => (
							<ListItem
								actions={<Remove name={one.name} />}
								className="px-2 py-1.5"
								extra={!one.onList && "不在名单上"}
								key={one.name}
								title={one.name}
							/>
						))}
					</List>
				</Block>
			</Example>
			<Example
				description="技能抽屉里的细分：一行一条链接，图标在左，人数写在行尾。"
				title="细分的词"
			>
				<List className="w-full p-0">
					{children.map((child) => (
						<ListItem
							avatar={<Icon className="mt-px" icon={TagIcon} size="small" />}
							className="px-2 py-2"
							extra={`${child.people} 人`}
							href={`#term-${child.word}`}
							key={child.word}
							onClick={stay}
							title={child.word}
						/>
					))}
				</List>
			</Example>
		</ExampleGrid>
	);
}

/** 列表页：试用、一项的几种状态、产品里的用法。 */
export function ListPage() {
	return (
		<DocPage
			facts={["头像、标题、说明", "行尾小字或动作", "整行链接"]}
			rules={{
				notes: [
					"一串同类的对象（人、词）用 List，一项一个 ListItem；不在调用处手写一行的内外边距和悬停。",
					"整行可点时给 render（路由的 <Link>）或 href：标题就是那条链接，覆盖整行，中键、右键照常；静态的一行不给，也就没有悬停。",
					"行尾动作放 actions，画在链接外；悬停或焦点落在行内时出现，行尾小字同时隐去。",
					"当前项给 active，不另加选中装饰。",
					'选择框放在一项外面：外层出 <li>，ListItem 写 as="div"。',
					"内边距要收紧（浮层里）时用 className 改 padding，不改圆角和字号。",
					"可以多选的一串结果用 ListView：表头和每一行的第一格是 18px 的选择框，整行的链接用 ListViewLink，选择格压在它上面。",
				],
				usage: `<List>\n  <ListItem\n    avatar={<Avatar size={32} title={name} />}\n    description={position}\n    render={<Link to="/s/$turnId/p/$empId" params={params} />}\n    title={name}\n  />\n</List>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用列表" },
				{ children: <Looks />, id: "appearance", title: "状态" },
				{
					children: <ListViewExample />,
					id: "list-view",
					title: "可多选的列表视图",
				},
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
