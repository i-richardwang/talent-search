import { XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import {
	List,
	ListItem,
	ListView,
	ListViewHeader,
	ListViewLink,
	ListViewRow,
} from "#/components/ui/list";
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
import { stay } from "../../kit/stay";

/** 交给 `render` 的链接：类名和标题由 ListItem 填进来，点下去留在这一页。 */
function Anchor({
	href,
	className,
	children,
}: {
	href: string;
	className?: string;
	children?: ReactNode;
}) {
	return (
		<a className={className} href={href} onClick={stay}>
			{children}
		</a>
	);
}

function Remove({ name }: { name: string }) {
	return <ActionIcon aria-label={`移除 ${name}`} icon={XIcon} size="small" />;
}

type End = "extra" | "actions";

function Playground() {
	const [description, setDescription] = useState(true);
	const [end, setEnd] = useState<End>("extra");
	const [link, setLink] = useState(true);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={description} onChange={setDescription}>
						说明
					</Checkbox>
				</Control>
				<Control label="行尾">
					<Segmented<End>
						onChange={setEnd}
						options={[
							{ label: "小字", value: "extra" },
							{ label: "动作", value: "actions" },
						]}
						value={end}
					/>
				</Control>
				<Control>
					<Checkbox checked={link} onChange={setLink}>
						整行链接
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<span>
						{link ? "整行是一条链接，悬停出底" : "静态的一行，没有悬停"}
					</span>
				}
			>
				<List className="w-full max-w-sm">
					{["林小雨", "欧阳明远"].map((name, index) => (
						<ListItem
							actions={end === "actions" && <Remove name={name} />}
							description={
								description &&
								(index === 0
									? "高级算法工程师 · 推荐算法部"
									: "数据工程师 · 数据平台部")
							}
							extra={end === "extra" && (index === 0 ? "3 条证据" : "1 条证据")}
							key={name}
							render={link ? <Anchor href={`#person-${index}`} /> : undefined}
							title={name}
						/>
					))}
				</List>
			</Stage>
		</div>
	);
}

const LOOKS: [
	name: string,
	note: string,
	props: { link?: boolean; actions?: boolean },
][] = [
	["静态", "没有链接：没有悬停、没有手形", {}],
	["render", "整行是一条链接：悬停出底", { link: true }],
	["actions", "行尾的动作画在链接外，一直显示", { actions: true }],
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
					{LOOKS.map(([name, note, { link, actions }]) => (
						<TableRow key={name}>
							<TableCell className="font-mono text-xs">{name}</TableCell>
							<TableCell className="min-w-64">
								<List className="p-0">
									<ListItem
										actions={actions && <Remove name="林小雨" />}
										description="高级算法工程师"
										extra={!actions && "3 条证据"}
										render={link ? <Anchor href="#look" /> : undefined}
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
				description="导出前已选的人：静态的一行，不在名单上的写在说明里，行尾是移除钮。"
				title="已选的人"
			>
				<List className="-mx-1 w-64">
					{picked.map((one) => (
						<ListItem
							actions={<Remove name={one.name} />}
							description={one.onList ? undefined : "不在名单上"}
							key={one.name}
							title={one.name}
						/>
					))}
				</List>
			</Example>
			<Example
				description="技能抽屉里的细分：一行一条链接，人数写在行尾。"
				title="细分的词"
			>
				<List className="w-full">
					{children.map((child) => (
						<ListItem
							extra={`${child.people} 人`}
							key={child.word}
							render={<Anchor href={`#term-${child.word}`} />}
							title={child.word}
						/>
					))}
				</List>
			</Example>
		</ExampleGrid>
	);
}

export function ListPage() {
	return (
		<DocPage
			facts={["标题、说明", "行尾小字或动作", "整行链接"]}
			rules={{
				notes: [
					"一串同类的对象（人、词）用 List，一项一个 ListItem；不在调用处手写一行的内外边距和悬停。",
					"整行可点时给 render（路由的 <Link>）：标题就是那条链接，覆盖整行，中键、右键照常；静态的一行不给，也就没有悬停。",
					"行尾放 extra（小字）或 actions（动作）之一；actions 画在链接外，一直显示。",
					"可以多选的一串结果用 ListView：表头和每一行的第一格是选择框，整行的链接用 ListViewLink，选择格压在它上面。",
				],
				usage: `<List>\n  <ListItem\n    extra={people}\n    render={<Link params={{ word }} to="/skills/$word" />}\n    title={word}\n  />\n</List>`,
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
