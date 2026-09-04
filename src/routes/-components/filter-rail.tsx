import { ListFilterIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "#/components/ui/popover";
import { ScrollArea } from "#/components/ui/scroll-area";
import { cn } from "#/lib/utils";
import {
	activeCount,
	type FilterField,
	type TextFilter,
} from "../-lib/filters";
import { CLEARED_FILTERS, type View } from "../-lib/view-params";

/**
 * 范围条件：在同一批候选里再看哪一部分。
 *
 * 它摊开成一条左栏，而不是一排可点开的小按钮。摊开买到的是**人数**：每个选项
 * 后面「点了还剩几个人」一直在，于是「点哪一个能把范围收得最狠」这个问题扫一眼
 * 就答完了；收进弹层之后这份对照只在弹层开着的那一刻存在，而那一刻已经太晚——
 * 人得先决定点开哪一维，才看得到自己该不该点开它。
 *
 * 摊开的东西必须**站得住**：这一栏的行只在换查询时变，点任何一个筛选都不会让
 * 别的行消失（口径在 `search/rank.ts` 的 `facetCount`）。被别的筛选挤到 0 的行
 * 留在原地、写着 0、点不动——那是用户自己刚做的事的后果，藏起来就没法回头。
 *
 * 它在名单**外面**，因为它不改问题，只改看法，连查询记录都不产生
 * （见 `-lib/commit.ts` 开头）。「记录还是视图」是这个产品最要紧的一条界线，
 * 屏幕上由位置说出来：查询台里的动作会派生新记录，这条栏里的只动 URL。
 *
 * 左筛选、右详情，中间是那条唯一的名单列——两侧都是辅助面，都吸顶、都自己滚，
 * 都用一条发丝线和中间那条列分开。lg 以下没有并排的余地，整栏收成一个按钮
 * （`FilterSheet`），装的是同一份东西。
 */

/** 一维默认摊开几项。再多就把「哪一维值得看」压在下面，得先滚才看得见。 */
const VISIBLE = 5;

export function FilterRail(props: FilterProps) {
	if (!hasAnything(props)) return null;
	return (
		/*
		 * 和详情面板同一套：吸顶、限高、`ScrollArea` 自己滚、靠一条边分层，不靠投影。
		 * `w-rail` 是版心算式里的那一项（styles.css），改宽度只改那一个数——所以这一栏
		 * 的宽度不能让滚动条来定（AGENTS.md「自己滚的面一律 `ScrollArea`」）。
		 */
		<aside
			aria-label="筛选"
			className={cn(
				"sticky top-(--header-height) hidden h-[calc(100dvh-var(--header-height))] w-rail shrink-0",
				"overflow-hidden border-border border-r lg:block",
			)}
		>
			<ScrollArea overscrollContain scrollFade>
				{/*
				 * 左右等距，而且是 16：栏里每一行自己带 8px 的行内边距，加起来正好是
				 * `app-column` 的 24px——于是这一栏的选项文字和顶栏左端落在同一条线上，
				 * 而每一行的底色在这一栏里左右留白相同。这一栏的左沿就是页框那根线。
				 *
				 * 内边距在这里而不是 `aside` 上：滚动条钉在 `aside` 的边上，留白给到
				 * 内容这一层，那条拇指才落在这 16px 里，压不到字。
				 */}
				<div className="p-4">
					<FilterList {...props} />
				</div>
			</ScrollArea>
		</aside>
	);
}

/**
 * 窄屏上的同一份东西。左栏在这里没有余地：并排三栏的最后一栏是名单本身，
 * 而名单不能让。
 */
export function FilterSheet(props: FilterProps) {
	if (!hasAnything(props)) return null;
	const count = activeCount(props.fields, props.textFilters);
	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button size="sm" variant="outline">
						<ListFilterIcon />
						筛选
						{/* 关着的时候，生效了几项是这个按钮唯一能说的话 */}
						{count > 0 && <span className="tabular-nums">{count}</span>}
					</Button>
				}
			/>
			{/*
			 * 高度不写死：弹层自己知道离屏幕边还有多少（`--available-height`），
			 * 内边距也由它给——它和左栏一样是 16，同一份东西在两处读起来才一样。
			 */}
			<PopoverPopup align="start" className="w-72">
				<FilterList {...props} />
			</PopoverPopup>
		</Popover>
	);
}

type FilterProps = {
	fields: FilterField[];
	/**
	 * 公司名 / 学校名这类精确条件。它们没有候选列表可展开，只在生效时出现，
	 * 长成一条能一键摘掉的行——和分面同在这一栏上，因为它们同样是
	 * 「在这批人里再看哪一部分」。
	 */
	textFilters: TextFilter[];
	onChange: (next: Partial<View>) => void;
};

/** 一个候选都数不出来的时候整栏不存在——空着的栏就是它不该占位的证据。 */
function hasAnything({ fields, textFilters }: FilterProps) {
	return fields.some((f) => f.options.length > 0) || textFilters.length > 0;
}

function FilterList({ fields, textFilters, onChange }: FilterProps) {
	const count = activeCount(fields, textFilters);

	return (
		<div className="flex flex-col gap-4">
			{/*
			 * 行高写死。「清除」有和没有的时候这一行必须一样高，否则下面每一维都
			 * 跟着上下跳一次——而它出现的那一刻，正是人刚点完一个筛选、眼睛还盯着
			 * 那一列人数的时候，跳的是他正在读的东西。
			 *
			 * 20px 取自这一行里较高的那个盒子：12px 的按钮字（行高 16）加上下各 1px
			 * 描边是 18，留 2px 余量。标题那 11px 的字比它矮，撑不到。
			 */}
			<div className="flex h-5 items-baseline justify-between gap-2 px-2">
				<span className="label text-muted-foreground">筛选</span>
				{count > 0 && (
					<Button
						className="h-auto p-0 text-xs"
						onClick={() => onChange(CLEARED_FILTERS)}
						size="xs"
						variant="link"
					>
						清除 {count} 项
					</Button>
				)}
			</div>

			{textFilters.map((t) => (
				<FilterGroup key={t.key} title={t.title}>
					<Row
						onClick={() => onChange(t.clear)}
						selected
						title={`取消「${t.title} ${t.value}」`}
					>
						<span className="min-w-0 flex-1 truncate text-start">
							{t.value}
						</span>
						<XIcon className="shrink-0 text-muted-foreground" />
					</Row>
				</FilterGroup>
			))}

			{fields.map((field) => (
				<FilterFacet field={field} key={field.key} onChange={onChange} />
			))}
		</div>
	);
}

function FilterFacet({
	field,
	onChange,
}: {
	field: FilterField;
	onChange: (next: Partial<View>) => void;
}) {
	const [all, setAll] = useState(false);
	if (field.options.length === 0) return null;

	const rest = field.options.length - VISIBLE;
	/*
	 * 收起时只摊开前几项，但**选中的项永远在场**：它排在第几位由分面的
	 * 人数决定，一旦掉出前几项就再也取消不掉了。提到最前面而不是把列表撑开，
	 * 是因为「现在筛的是什么」比「还能筛什么」先被读到。
	 */
	const visible = all ? field.options : collapse(field);

	return (
		<FilterGroup title={field.title}>
			{visible.map((o) => {
				const selected = field.values.includes(o.value);
				return (
					<Row
						/* 数到 0 的行留着但点不动：它说的是「这个值存在，只是和你现在
						   的筛选冲突」。选中的那一行永远点得动，否则就取消不掉了。 */
						disabled={o.n === 0 && !selected}
						key={o.value}
						/* 再点一次就是取消，所以「不限」不必单占一行——选中的那一行
						   本来就是最容易被再点一次的地方。一维之内能同时选中几项，
						   由这一维自己说了算（`-lib/filters.ts`）。 */
						onClick={() => onChange(field.toggle(o.value))}
						selected={selected}
					>
						<span className="min-w-0 flex-1 truncate text-start">
							{o.label}
						</span>
						{/* 人数右对齐、等宽数字：一列数字竖着比，才看得出点哪个收得最狠 */}
						<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
							{o.n}
						</span>
					</Row>
				);
			})}
			{!all && rest > 0 && (
				<Button
					className="justify-start px-2 text-muted-foreground"
					onClick={() => setAll(true)}
					size="sm"
					variant="ghost"
				>
					更多 {rest} 项
				</Button>
			)}
		</FilterGroup>
	);
}

/**
 * 收起时摊开哪几项：前 VISIBLE 项，加上被挤在后面的那些选中项——它们提到最前面。
 * 选中的一个都不能藏，藏起来就取消不掉了。
 */
function collapse({ options, values }: FilterField) {
	const head = options.slice(0, VISIBLE);
	const buried = options.filter(
		(o) => values.includes(o.value) && !head.includes(o),
	);
	if (buried.length === 0) return head;
	return [...buried, ...head.slice(0, Math.max(VISIBLE - buried.length, 0))];
}

/** 一维一组：分区标签 + 若干行。标签走全站的 `label` 档，一眼是「不是内容」。 */
function FilterGroup({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-0.5">
			<h3 className="label px-2 pb-1 text-muted-foreground">{title}</h3>
			{children}
		</section>
	);
}

/**
 * 一行一个选项。选中是**实心的次要底**，未选是 ghost——和 chips 那边同一套
 * （`query-chips.tsx` 的 `MODE_VARIANT`），全站不为「选中」另发一个颜色。
 */
function Row({
	children,
	disabled,
	onClick,
	selected,
	title,
}: {
	children: React.ReactNode;
	disabled?: boolean;
	onClick: () => void;
	selected: boolean;
	title?: string;
}) {
	return (
		<Button
			className="w-full justify-start px-2"
			disabled={disabled}
			onClick={onClick}
			size="sm"
			title={title}
			variant={selected ? "secondary" : "ghost"}
		>
			{children}
		</Button>
	);
}
