import { cn, Text } from "@cloudflare/kumo";
import { useState } from "react";
import { activeFilters, type FilterField } from "../-lib/filters";
import { CLEARED_FILTERS, type View } from "../-lib/view-params";
import { Dot } from "./evidence";

/** 每组默认露出几项。再多就要人先读一屏才能开始筛，那不如收起来。 */
const VISIBLE = 6;

/**
 * 左栏：筛选。常驻的索引，不是临时的控件。
 *
 * 摊开成一列而不是收进弹层，白拿三件事：每个选项后面的人数一直可见，
 * 「值不值得点」不用先点开才知道；选中态就长在选项本身上，不需要另造一排
 * 标签来复述「现在筛的是什么」；没有弹层，也就没有弹层被别的东西盖住的可能。
 *
 * 每一项都是开关：点已选中的那项就是取消它。所以这里没有「清除这一个」的
 * 叉号，也不需要——多一个叉号就是给同一件事多画一个入口。
 *
 * 每一项后面那个数的口径由 rank.ts 的 computeFacets 定义，和中栏那句
 * 「共 N 人」是同一个单位。数不出人的选项根本不会送到这里来，所以这一列的
 * 长度跟着查询走——左栏能短，靠的是计数准，不是折叠得狠。
 */
export function FilterRail({
	fields,
	view,
	onChange,
	strongCount,
	hasQuery,
	className,
}: {
	/** 已经算好的四个维度（`filters.ts` 的 `filterFields`）。左栏只负责画。 */
	fields: FilterField[];
	view: View;
	onChange: (next: Partial<View>) => void;
	/** 打开「匹配来源」之后还剩多少人，口径同其余四维。 */
	strongCount: number;
	hasQuery: boolean;
	className?: string;
}) {
	const count = activeFilters(fields).length;

	return (
		<nav
			aria-label="筛选"
			className={cn(
				"flex flex-col overflow-y-auto border-kumo-hairline",
				className,
			)}
		>
			{/* 56px：和顶栏、中栏那条结果头收在同一条水平线上 */}
			<div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
				<Text as="h2" bold size="xs" variant="secondary">
					筛选
				</Text>
				{count > 0 && (
					<button
						/* 视觉 16px，命中区 40px：小控件不该按尺寸缩水触控目标 */
						className="relative rounded-control text-kumo-link text-xs after:absolute after:-inset-y-3 after:inset-x-0 after:content-[''] hover:underline"
						onClick={() => onChange(CLEARED_FILTERS)}
						type="button"
					>
						清除 {count} 项
					</button>
				)}
			</div>

			{/* 没有查询就没有可筛的东西。与其摆一排点了没反应的控件，不如说清楚。 */}
			{hasQuery ? (
				// px-1.5 + 选项自己的 px-2.5 = 16px，和顶栏、表格首列、详情栏同一条竖线
				<div className="space-y-6 px-1.5 pb-6">
					{fields.map((field) => (
						// key 带上选项数：换了查询就重新收起。左栏的长度该由计数决定，
						// 不该由上一次查询里点没点过「还有 N 项」决定。
						<Group
							field={field}
							key={`${field.key}:${field.options.length}`}
							onChange={onChange}
						/>
					))}
					<StrengthGate n={strongCount} onChange={onChange} view={view} />
				</div>
			) : (
				/* 13 而不是 12：这是说明性文本，和详情栏空态那句同一档。
				   两条空态提示用两个字号，是「这两处不是一个人写的」的样子。 */
				<p className="px-4 text-kumo-subtle text-sm">搜索后可使用筛选。</p>
			)}
		</nav>
	);
}

function Group({
	field,
	onChange,
}: {
	field: FilterField;
	onChange: (next: Partial<View>) => void;
}) {
	const [open, setOpen] = useState(false);
	// 已选中的那项必须始终可见，哪怕它排在第 40 位——否则收起来之后
	// 界面上就没有任何东西解释「为什么只剩这几个人」。
	const selectedIndex = field.options.findIndex((o) => o.value === field.value);
	const shown =
		open || selectedIndex >= VISIBLE
			? field.options
			: field.options.slice(0, VISIBLE);
	const hidden = field.options.length - shown.length;

	if (field.options.length === 0) return null;

	return (
		<section>
			{/*
			 * 组标题比选项**淡**，不是比选项重。
			 *
			 * 12px 的汉字上字重差异几乎不可见，靠 bold 分不出组标题和选项，
			 * 「序列」「入职前公司」会读起来像几个灰掉的选项。所以选项用 default、
			 * 标题留在 subtle：标签安静，内容可读。
			 */}
			<div className="px-2.5 pb-1.5">
				<Text as="h3" size="xs" variant="secondary">
					{field.title}
				</Text>
			</div>
			{shown.map((o) => (
				<Option
					key={o.value}
					label={o.label}
					n={o.n}
					// 点已选中的那项 = 取消它
					onClick={() =>
						onChange(field.set(o.value === field.value ? undefined : o.value))
					}
					selected={o.value === field.value}
				/>
			))}
			{hidden > 0 && (
				<button
					className="relative rounded-control px-2.5 py-1 text-kumo-link text-xs after:absolute after:-inset-y-2 after:inset-x-0 after:content-[''] hover:underline"
					onClick={() => setOpen(true)}
					type="button"
				>
					还有 {hidden} 项
				</button>
			)}
		</section>
	);
}

/**
 * 「每个词都要受控字段命中」。
 *
 * 它问的是「证据够不够硬」而不是「人群有多大」，但对用的人来说是同一件事：
 * 收窄结果。所以放在同一列里、长成同一个样子、后面同样跟一个人数——
 * 这个数就是中栏不必再写「已排除 N 人」的原因。
 * 前面那颗点比再写一遍「受控字段指序列和岗位」省一整句话。
 */
function StrengthGate({
	view,
	onChange,
	n,
}: {
	view: View;
	onChange: (next: Partial<View>) => void;
	n: number;
}) {
	return (
		<section>
			<div className="px-2.5 pb-1.5">
				<Text as="h3" size="xs" variant="secondary">
					匹配来源
				</Text>
			</div>
			<Option
				icon={<Dot strength="controlled" />}
				label="岗位或序列"
				n={n}
				onClick={() => onChange({ strong: view.strong ? undefined : true })}
				selected={Boolean(view.strong)}
			/>
		</section>
	);
}

function Option({
	label,
	n,
	selected,
	onClick,
	icon,
}: {
	label: string;
	n?: number;
	selected: boolean;
	onClick: () => void;
	icon?: React.ReactNode;
}) {
	return (
		<button
			aria-pressed={selected}
			className={cn(
				// 视觉 32px、命中区 40px：这三类控件是筛选的唯一入口，而 xl 以下
				// 它们只在那个触屏上的筛选对话框里出现——正是最需要 40px 的场景。伪元素外扩，
				// 不动视觉尺寸，密集档案感不受影响。
				"relative after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
				// 32px 行高 = 13px 文字（行高 15px）+ 上下各 8px。左栏是索引，
				// 比中栏 37px 的数据行轻一档；再矮就只剩一列贴在一起的字。
				"flex w-full items-center gap-2 rounded-sheet px-2.5 py-2 text-left text-sm",
				selected
					? "bg-kumo-info-tint font-medium text-kumo-default"
					: "text-kumo-default [@media(hover:hover)]:hover:bg-kumo-fill",
			)}
			/* 整行宽的按钮不做按压缩放：224px 的东西缩 3%，文字会横移三四个像素，
         读起来是这一行在抖。按压反馈是给紧凑控件的，见 styles.css。 */
			data-press="off"
			onClick={onClick}
			type="button"
		>
			{icon}
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{n !== undefined && (
				<span className="shrink-0 text-kumo-subtle tabular-nums">{n}</span>
			)}
		</button>
	);
}
