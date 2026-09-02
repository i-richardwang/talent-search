import { XIcon } from "lucide-react";
import { Dot } from "#/components/evidence";
import { Button } from "#/components/ui/button";
import { Group } from "#/components/ui/group";
import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
} from "#/components/ui/select";
import { Toggle } from "#/components/ui/toggle";
import { cn } from "#/lib/utils";
import {
	activeFilters,
	type FilterField,
	type TextFilter,
} from "../-lib/filters";
import { CLEARED_FILTERS, type View } from "../-lib/view-params";

/**
 * 范围条件：一个维度一段，五段连成**一条分段控件**，排在概念条件（chips）后面。
 *
 * 连起来是关键。这一排和 chips 那一排都是「可点开的小按钮」，各自独立摆着的
 * 时候，两类条件在屏幕上长得一模一样，唯一的分组线索是换行——而换行是布局的
 * 意外，窗口窄一点最后一枚 chip 就掉进筛选那一排里。连成一条之后边界由形状给：
 * 一条带两个圆头的段控是一个整体，散着的 chip 是一枚一枚的词。
 *
 * 不给它一条常驻的竖栏。一条从头到尾占着的侧栏是后台导航的形状，会把一个
 * 单列的搜索工具画成管理后台，而这五个维度的使用频率远不到需要永久占位。
 *
 * 收进弹层要付一样代价：摊开的列表里「每个选项后面还剩几个人」是一直可见的。
 * 这里把它拆成两半买回来——**选中的值直接长在段上**（不点开也知道现在筛的
 * 是什么，这是摊开时最重要的那一半），**人数留在弹层里**（它只在「要不要点
 * 这一项」的那一刻有用，而那一刻弹层正开着）。
 */
export function FilterBar({
	fields,
	textFilters,
	view,
	onChange,
	strongCount,
}: {
	fields: FilterField[];
	/**
	 * 公司名 / 学校名这类精确条件。它们没有候选列表可展开，只在生效时出现，
	 * 长成一段能一键摘掉的段——和分面同在一条段控上，因为它们同样是
	 * 「在这批人里再看哪一部分」。
	 */
	textFilters: TextFilter[];
	view: View;
	onChange: (next: Partial<View>) => void;
	/** 打开「匹配来源」之后还剩多少人，口径同其余各维 */
	strongCount: number;
}) {
	const count = activeFilters(fields, textFilters).length;

	return (
		<div className="flex flex-wrap items-center gap-2">
			{/* max-w-full + 每段 min-w-0：段多的时候整条一起收窄并截断，
			    不换行——一条断成两截的段控就不再是一个整体了。 */}
			<Group className="max-w-full">
				{fields.map((field) => (
					<FilterSelect field={field} key={field.key} onChange={onChange} />
				))}
				{textFilters.map((t) => (
					<Button
						key={t.key}
						onClick={() => onChange(t.clear)}
						size="sm"
						title={`取消「${t.title} ${t.value}」`}
						variant="outline"
					>
						<span className="text-muted-foreground">{t.title}</span>
						<span className="truncate">{t.value}</span>
						<XIcon />
					</Button>
				))}
				<StrengthToggle n={strongCount} onChange={onChange} view={view} />
			</Group>
			{count > 0 && (
				<Button
					className="text-muted-foreground"
					onClick={() => onChange(CLEARED_FILTERS)}
					size="sm"
					variant="link"
				>
					清除 {count} 项
				</Button>
			)}
		</div>
	);
}

/** 弹层里那一项「不筛这一维」。Select 选中项再点一次不会触发变化，得给它一行。 */
const ANY = "__any__";

function FilterSelect({
	field,
	onChange,
}: {
	field: FilterField;
	onChange: (next: Partial<View>) => void;
}) {
	if (field.options.length === 0) return null;
	const selected = field.options.find((o) => o.value === field.value);

	return (
		<Select
			onValueChange={(v) =>
				onChange(field.set(typeof v === "string" && v !== ANY ? v : undefined))
			}
			value={field.value ?? ANY}
		>
			<SelectTrigger className="min-w-0" size="sm">
				{/*
				 * 选中之后段上写的是**值**，不是「序列：值」。维度名在没选的时候
				 * 才有用（它是在问「要不要按这个筛」）；选了之后值自己就说明了
				 * 是哪个维度——「大厂」「1 年」「公司内经历」没有一个会认错。
				 * 前缀留着只会让一排段里一半的宽度是重复的标签。
				 */}
				<span
					className={cn("truncate", !selected && "text-muted-foreground")}
					data-slot="filter-value"
				>
					{selected ? selected.label : field.title}
				</span>
			</SelectTrigger>
			<SelectPopup className="max-h-80">
				<SelectItem value={ANY}>
					<span className="text-muted-foreground">不限{field.title}</span>
				</SelectItem>
				{field.options.map((o) => (
					/*
					 * 一格两段：选项，和还剩几个人。人数右对齐并用等宽数字，
					 * 于是一列数字能竖着比——「点哪一个能把范围收得最狠」这个问题
					 * 靠扫一眼就答完了，不必逐行读。
					 */
					<SelectItem key={o.value} value={o.value}>
						<span className="flex w-full items-center gap-3">
							<span className="min-w-0 flex-1 truncate">{o.label}</span>
							<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
								{o.n}
							</span>
						</span>
					</SelectItem>
				))}
			</SelectPopup>
		</Select>
	);
}

/**
 * 「每个词都要受控字段命中」。
 *
 * 它只有开关两态，没有值可选，所以不做成 Select——为一个布尔量弹一层，
 * 是多点一下换零信息。`Toggle` 是这件事的原生形状：按下态由组件自己用
 * `data-pressed` 表示，不必手写 `aria-pressed` 再自配一套底色。
 *
 * 点亮时前面那颗点就是它的说明：和证据行、图例里那颗实心绿点是同一颗，
 * 比再写一句「受控字段指序列和岗位」省一整句话。
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
	// 一个人都数不出来时不给这一段——点下去必然清空名单，那是一条死路。
	// 其余四维靠「数不出人的选项根本不进分面」自动做到这件事（见 result.ts），
	// 只有这一维是布尔的，没有选项列表可以空，所以得在这里挡一次。
	// 已经点亮的那一段永远留着：否则筛到 0 人之后就没有任何东西能取消它了。
	if (!on && n === 0) return null;
	return (
		<Toggle
			onPressedChange={(next) => onChange({ strong: next || undefined })}
			pressed={on}
			size="sm"
			variant="outline"
		>
			<Dot strength="controlled" />
			<span>岗位或序列命中</span>
			{!on && <span className="text-muted-foreground tabular-nums">{n}</span>}
		</Toggle>
	);
}
