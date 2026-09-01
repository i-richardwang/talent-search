import { ChevronDownIcon, XIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	Menu,
	MenuPopup,
	MenuRadioGroup,
	MenuRadioItem,
	MenuTrigger,
} from "#/components/ui/menu";
import { cn } from "#/lib/utils";
import { activeFilters, type FilterField } from "../-lib/filters";
import { CLEARED_FILTERS, type View } from "../-lib/view-params";
import { Dot } from "./evidence";

/**
 * 范围条件：一个维度一枚可展开的按钮，排在概念条件（chips）后面。
 *
 * 不给它一条常驻的竖栏。一条从头到尾占着的侧栏是后台导航的形状，会把一个
 * 单列的搜索工具画成管理后台，而这五个维度的使用频率远不到需要永久占位。
 *
 * 收进弹层要付一样代价：摊开的列表里「每个选项后面还剩几个人」是一直可见的。
 * 这里把它拆成两半买回来——**选中的值直接长在按钮上**（不点开也知道现在筛的
 * 是什么，这是摊开时最重要的那一半），**人数留在弹层里**（它只在「要不要点
 * 这一项」的那一刻有用，而那一刻弹层正开着）。
 *
 * 这一行里的每一枚都是 `Button size="xs"`，和 chips 用的是同一个尺码
 * （见 query-chips.tsx）。它们说的是同一件事——这次检索的条件——所以尺寸、
 * 圆角、焦点环、按压态和触控目标全部由同一个组件给，不靠两处手写去对齐。
 */
export function FilterBar({
	fields,
	view,
	onChange,
	strongCount,
	className,
}: {
	fields: FilterField[];
	view: View;
	onChange: (next: Partial<View>) => void;
	/** 打开「匹配来源」之后还剩多少人，口径同其余四维 */
	strongCount: number;
	className?: string;
}) {
	const count = activeFilters(fields).length;

	return (
		<div className={cn("flex flex-wrap items-center gap-1.5", className)}>
			{fields.map((field) => (
				<FilterMenu field={field} key={field.key} onChange={onChange} />
			))}
			<StrengthToggle n={strongCount} onChange={onChange} view={view} />
			{count > 0 && (
				<Button
					className="text-muted-foreground"
					onClick={() => onChange(CLEARED_FILTERS)}
					size="xs"
					variant="link"
				>
					清除 {count} 项
				</Button>
			)}
		</div>
	);
}

function FilterMenu({
	field,
	onChange,
}: {
	field: FilterField;
	onChange: (next: Partial<View>) => void;
}) {
	if (field.options.length === 0) return null;
	const selected = field.options.find((o) => o.value === field.value);

	return (
		<Menu>
			<MenuTrigger
				render={
					<Button size="xs" variant={selected ? "secondary" : "outline"} />
				}
			>
				{/*
				 * 选中之后按钮上写的是**值**，不是「序列：值」。维度名在没选的时候
				 * 才有用（它是在问「要不要按这个筛」）；选了之后值自己就说明了
				 * 是哪个维度——「大厂」「1 年」「公司内经历」没有一个会认错。
				 * 前缀留着只会让一排按钮里一半的宽度是重复的标签。
				 */}
				<span className="max-w-40 truncate">
					{selected ? selected.label : field.title}
				</span>
				<ChevronDownIcon />
			</MenuTrigger>
			<MenuPopup align="start" className="max-h-80 overflow-y-auto">
				<FilterOptions field={field} onChange={onChange} />
			</MenuPopup>
		</Menu>
	);
}

/*
 * 弹层里那份选项表。
 *
 * 它不能脱开 `Menu` 直出——Base UI 的 radio item 离了 `Menu.Root` 就抛错——
 * 所以「人数在不在」「裸值有没有泄漏成文案」这些不变量在这一层是测不到的。
 * 它们钉在 `filterFields` 上（tests/filters.test.ts）：那些事实本来就产在
 * 那里，这里只是把它画出来。这一层能测的是**触发器行**，见
 * tests/filter-bar.test.tsx。
 */
function FilterOptions({
	field,
	onChange,
}: {
	field: FilterField;
	onChange: (next: Partial<View>) => void;
}) {
	return (
		<MenuRadioGroup
			onValueChange={(v) =>
				onChange(field.set(v === field.value ? undefined : v))
			}
			value={field.value}
		>
			{field.options.map((o) => (
				<MenuRadioItem key={o.value} value={o.value}>
					{/*
					 * 一格两段：选项，和还剩几个人。人数右对齐并用等宽数字，
					 * 于是一列数字能竖着比——「点哪一个能把范围收得最狠」这个问题
					 * 靠扫一眼就答完了，不必逐行读。
					 */}
					<span className="flex w-full items-center gap-2">
						<span className="min-w-0 flex-1 truncate">{o.label}</span>
						<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
							{o.n}
						</span>
					</span>
				</MenuRadioItem>
			))}
		</MenuRadioGroup>
	);
}

/**
 * 「每个词都要受控字段命中」。
 *
 * 它只有开关两态，没有值可选，所以不做成菜单——为一个布尔量弹一层，
 * 是多点一下换零信息。点亮时前面那颗点就是它的说明：和证据行、图例里
 * 那颗实心绿点是同一颗，比再写一句「受控字段指序列和岗位」省一整句话。
 */
function StrengthToggle({
	view,
	onChange,
	n,
}: {
	view: View;
	onChange: (next: Partial<View>) => void;
	n: number;
}) {
	const on = Boolean(view.strong);
	// 一个人都数不出来时不给这枚按钮——点下去必然清空名单，那是一条死路。
	// 其余四维靠「数不出人的选项根本不进分面」自动做到这件事（见 result.ts），
	// 只有这一维是布尔的，没有选项列表可以空，所以得在这里挡一次。
	// 已经点亮的那一枚永远留着：否则筛到 0 人之后就没有任何东西能取消它了。
	if (!on && n === 0) return null;
	return (
		<Button
			aria-pressed={on}
			onClick={() => onChange({ strong: on ? undefined : true })}
			size="xs"
			variant={on ? "secondary" : "outline"}
		>
			<Dot strength="controlled" />
			<span>岗位或序列命中</span>
			{on ? (
				<XIcon />
			) : (
				<span className="text-muted-foreground tabular-nums">{n}</span>
			)}
		</Button>
	);
}
