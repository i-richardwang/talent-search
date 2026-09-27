import {
	Activity,
	ArrowDown,
	BriefcaseBusiness,
	Building2,
	CalendarClock,
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	CircleAlert,
	CircleCheck,
	CircleDashed,
	CircleX,
	Clock,
	Download,
	Eye,
	EyeOff,
	FileQuestion,
	GitMerge,
	GraduationCap,
	Hash,
	History,
	Keyboard,
	Link,
	List,
	ListChecks,
	Loader2,
	type LucideIcon,
	MessageSquareText,
	MessageSquareWarning,
	MessagesSquare,
	MoreHorizontal,
	PanelLeftClose,
	PanelLeftOpen,
	PencilLine,
	Play,
	Plus,
	RotateCw,
	ScrollText,
	SearchX,
	Split,
	SquarePen,
	Table,
	Tags,
	TextSearch,
	ThumbsUp,
	Trash,
	TriangleAlert,
	UsersRound,
	X,
} from "lucide-react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { ICON_PRESET, Icon } from "#/components/ui/icon";
import { DocPage } from "../../kit/page";

/**
 * 产品页面（组件库以外）用到的每个图标和它在产品里的意思。一个意思只用一个图标，
 * 一个图标只表一个意思；测试核对这张表和页面代码里的 lucide 导入一一对应。
 */
export const PRODUCT_ICONS: [
	name: string,
	icon: LucideIcon,
	meaning: string,
][] = [
	["Loader2", Loader2, "正在处理，转圈"],
	["SearchX", SearchX, "没有找到匹配的人或词"],
	["MessageSquareWarning", MessageSquareWarning, "AI 没有整理出搜索条件"],
	["RotateCw", RotateCw, "重试"],
	["EyeOff", EyeOff, "停用的搜索条件"],
	["Download", Download, "导出名单"],
	["List", List, "看已选的人"],
	["Check", Check, "已选中的一项"],
	["X", X, "关闭、移除、退出"],
	["ChevronDown", ChevronDown, "展开：选项、一次运行的错误"],
	["ChevronUp", ChevronUp, "收起多出来的几项"],
	["SquarePen", SquarePen, "新搜索"],
	["Plus", Plus, "添加一条替代条件"],
	["Building2", Building2, "关键词里的公司或部门"],
	["GraduationCap", GraduationCap, "关键词里的学校"],
	["Clock", Clock, "关键词里的累计年限"],
	["ListChecks", ListChecks, "示例：一句话里几样要求都要满足"],
	["GitMerge", GitMerge, "示例：两段经历都要有"],
	["ThumbsUp", ThumbsUp, "示例：「最好」是加分项"],
	["Split", Split, "示例：「或者」做过其中一样就行"],
	["History", History, "正在看较早的一次结果"],
	["BriefcaseBusiness", BriefcaseBusiness, "人的详情里的任职经历"],
	["Keyboard", Keyboard, "快捷键列表"],
	["MessageSquareText", MessageSquareText, "最近搜索里的一次 AI 搜索"],
	["TextSearch", TextSearch, "最近搜索里的一次关键词搜索"],
	[
		"PanelLeftOpen",
		PanelLeftOpen,
		"窄屏上打开导航抽屉，宽屏上展开收起的导航栏",
	],
	["PanelLeftClose", PanelLeftClose, "收起导航栏"],
	["MessagesSquare", MessagesSquare, "对话"],
	["UsersRound", UsersRound, "人才搜索"],
	["Table", Table, "数据"],
	["Tags", Tags, "技能"],
	["Activity", Activity, "任务"],
	["Play", Play, "立即运行一次任务"],
	["CalendarClock", CalendarClock, "一类任务的运行记录"],
	["ScrollText", ScrollText, "一次运行的日志"],
	["CircleCheck", CircleCheck, "运行成功"],
	["CircleX", CircleX, "运行失败"],
	["CircleAlert", CircleAlert, "运行中断"],
	["CircleDashed", CircleDashed, "还没处理到当前版本"],
	["ChevronLeft", ChevronLeft, "上一页"],
	["ChevronRight", ChevronRight, "下一页"],
	["Eye", Eye, "查看那一次的结果"],
	["PencilLine", PencilLine, "直接在搜索条件上改的一次"],
	["ArrowDown", ArrowDown, "跳转到对话里最新的一句"],
	[
		"MoreHorizontal",
		MoreHorizontal,
		"更多：一行或一组的操作菜单、列不完的其余几条",
	],
	[
		"TriangleAlert",
		TriangleAlert,
		"需要留意：没有采用的一条要求、没加载出来的搜索记录",
	],
	["FileQuestion", FileQuestion, "页面不存在"],
	["Hash", Hash, "最近搜索列几条"],
	["Link", Link, "复制一条搜索记录的链接"],
	["Trash", Trash, "删除一条搜索记录"],
];

const TIERS = Object.entries(ICON_PRESET) as [
	keyof typeof ICON_PRESET,
	number,
][];

function Sizes() {
	return (
		<div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
			{TIERS.map(([tier, px]) => (
				<Block gap={14} key={tier} padding={20} variant="outlined">
					<div className="flex h-12 items-center">
						<Icon icon={SquarePen} size={tier} />
					</div>
					<div className="flex flex-col gap-0.5 text-xs">
						<code className="font-medium">{tier}</code>
						<span className="text-fg-tertiary tabular-nums">
							{px}px · 线宽 2
						</span>
					</div>
				</Block>
			))}
			<Block gap={14} padding={20} variant="outlined">
				<div className="flex h-12 items-center gap-1.5 text-sm">
					<Icon icon={History} />
					较早的一次结果
				</div>
				<div className="flex flex-col gap-0.5 text-xs">
					<code className="font-medium">不传</code>
					<span className="text-fg-tertiary">1em，跟着所在的字号</span>
				</div>
			</Block>
		</div>
	);
}

function Vocabulary() {
	return (
		<div className="grid grid-cols-3 gap-2 max-lg:grid-cols-2 max-md:grid-cols-1">
			{PRODUCT_ICONS.map(([name, icon, meaning]) => (
				<Block
					align="center"
					gap={12}
					horizontal
					key={name}
					padding={12}
					variant="outlined"
				>
					<Icon icon={icon} size="middle" />
					<div className="flex min-w-0 flex-col gap-0.5 text-xs">
						<span className="font-medium">{meaning}</span>
						<code className="text-fg-tertiary">{name}</code>
					</div>
				</Block>
			))}
		</div>
	);
}

function InButtons() {
	return (
		<Block gap={16} padding={20} variant="outlined">
			<div className="flex flex-wrap items-center gap-2">
				<Button icon={Download} type="primary">
					导出名单
				</Button>
				<Button icon={RotateCw}>重试</Button>
			</div>
			<p className="text-fg-secondary text-xs">
				按钮里的图标由按钮按 small 画，和文字之间的距离是按钮令牌里的图文间距。
			</p>
		</Block>
	);
}

/** 图标：两档预设尺寸与跟随字号，以及产品页面里每个图标的意思。 */
export function IconsPage() {
	return (
		<DocPage
			facts={[
				`${TIERS.length} 档预设尺寸`,
				"跟随字号",
				`${PRODUCT_ICONS.length} 个产品图标`,
			]}
			rules={{
				notes: [
					"图标只来自 lucide-react，经 Icon、Button 的 icon 或 ActionIcon 画，不直接写 svg。",
					"一个意思只用一个图标：要表达上面列过的意思，就用上面那个图标。",
					"新的意思先加到这张表里，测试会核对页面代码里的导入。",
					"只有图标的按钮用 ActionIcon，并给 title。",
				],
				usage: `<Icon icon={SquarePen} size="small" />`,
			}}
			sections={[
				{ children: <Sizes />, id: "sizes", title: "尺寸" },
				{ children: <Vocabulary />, id: "vocabulary", title: "产品图标" },
				{ children: <InButtons />, id: "buttons", title: "在按钮里" },
			]}
		/>
	);
}
