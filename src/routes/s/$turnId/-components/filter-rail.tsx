import { ChevronDownIcon, ListFilterIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { CheckboxGroup } from "#/components/ui/checkbox-group";
import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from "#/components/ui/collapsible";
import { Field, FieldItem, FieldLabel } from "#/components/ui/field";
import { Fieldset, FieldsetLegend } from "#/components/ui/fieldset";
import { Popover, PopoverPopup, PopoverTrigger } from "#/components/ui/popover";
import { Radio, RadioGroup } from "#/components/ui/radio-group";
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
 * 别的行消失（口径在 `search/rank.ts` 的 `facetRows`）。被别的筛选挤到 0 的行
 * 留在原地、写着 0、点不动——那是用户自己刚做的事的后果，藏起来就没法回头。
 *
 * **一维能选几项，由控件形状说。** 能多选的维度是一组复选框，只能选一个的是一组
 * 单选加一枚「不限」（`-lib/filters.ts` 的 `multi`）：点第二项之前就得知道它是
 * 加上去还是换掉刚才那个，而那正是这一维的定义。选中态也因此归控件自己
 * （`data-checked`）——拿一颗按钮加一层底色去表示选中，屏幕上看着一样，读屏
 * 念出来却是「按钮 P7 128」，一个字都听不出它是开着的。
 *
 * 它在名单**外面**，因为它不改问题，只改看法，连查询记录都不产生
 * （见 `routes/-lib/commit.ts` 开头）。「记录还是视图」是这个产品最要紧的一条界线，
 * 屏幕上由位置说出来：查询台里的动作会派生新记录，这条栏里的只动 URL。
 *
 * 左筛选、右详情，中间是那条唯一的名单列——两侧都是辅助面，都吸顶、都自己滚，
 * 都用一条发丝线和中间那条列分开。lg 以下没有并排的余地，整栏收成一个按钮
 * （`FilterSheet`），装的是同一份东西。
 */

/** 一维默认摊开几项。再多就把「哪一维值得看」压在下面，得先滚才看得见。 */
const VISIBLE = 5;

export function FilterRail({
	loading,
	...props
}: FilterProps & {
	/** 这一份结果还没跑出来。见下面那条「等结果的时候先占位」。 */
	loading: boolean;
}) {
	const anything = hasAnything(props);
	/*
	 * 空着就不存在——但**等结果的时候占位**。
	 *
	 * 有结果就一定有分面（`rank.ts` 的 `facetRows` 从结果算），所以这一栏接下来
	 * 必然在场；等的时候不占的话，结果回来的那一帧整条名单会横着挪半栏宽——
	 * 这一屏上最大的一次晃动，而没有任何检查会报它。占的只是**宽度**：里面此刻
	 * 一个字都不画，拿骨架块把一栏填满是另一回事（那是填充物）。
	 *
	 * 手上已经有分面就照常画，哪怕正在跑下一次检索：换一个筛选时这一栏的行不变
	 * （`facetRows` 的口径），清空再画回来才是无端闪一下。
	 */
	if (!anything && !loading) return null;
	return (
		/*
		 * 和详情面板同一套：吸在常驻那一叠（顶栏加查询带，`--chrome-height`）下沿、
		 * 限高、`ScrollArea` 自己滚、靠一条边分层，不靠投影。
		 * `w-rail` 是版心算式里的那一项（styles.css），改宽度只改那一个数——所以这一栏
		 * 的宽度不能让滚动条来定（AGENTS.md「自己滚的面一律 `ScrollArea`」）。
		 */
		<aside
			aria-label="筛选"
			className={cn(
				"sticky top-(--chrome-height) hidden h-[calc(100dvh-var(--chrome-height))] w-rail shrink-0",
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
				{anything && (
					<div className="p-4">
						<FilterList {...props} />
					</div>
				)}
			</ScrollArea>
		</aside>
	);
}

/**
 * 窄屏上的同一份东西。左栏在这里没有余地：并排三栏的最后一栏是名单本身，
 * 而名单不能让。
 */
export function FilterSheet({
	loading,
	...props
}: FilterProps & { loading: boolean }) {
	const anything = hasAnything(props);
	// 和左栏同一条：等结果的时候先占位，否则名单会在结果回来的那一帧往下跳一格。
	// 占位的那一刻它按不下去——里面还没有任何一维可选。
	if (!anything && !loading) return null;
	const count = activeCount(props.fields, props.textFilters);
	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button disabled={!anything} size="sm" variant="outline">
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
			 * 「清除」一直在，一项都没有时只是看不见——这一行的高度因此由按钮自己
			 * 给出，不由「这一刻有没有它」给出。它出现的那一刻，正是人刚点完一个
			 * 筛选、眼睛还盯着那一列人数的时候，那一跳跳的是他正在读的东西。
			 * `invisible` 是 `visibility: hidden`，同时把它从 Tab 序和读屏里拿掉，
			 * 所以留下的是一格高度，不是一个藏起来还按得到的按钮。
			 */}
			<div className="flex items-center justify-between gap-2 px-2">
				<span className="label text-muted-foreground">筛选</span>
				<Button
					className={cn(count === 0 && "invisible")}
					onClick={() => onChange(CLEARED_FILTERS)}
					size="xs"
					variant="link"
				>
					清除 {count} 项
				</Button>
			</div>

			{/* 文本条件不是分面：它没有候选，只有「摘掉」这一个动作，所以它是一颗
			    按钮，不是一枚勾——勾要回答「勾上会怎样」，而这里勾不上第二个值。 */}
			{textFilters.map((t) => (
				<section className="flex flex-col gap-0.5" key={t.key}>
					<h2 className="label px-2 pb-1 text-muted-foreground">{t.title}</h2>
					<Button
						className="w-full justify-start px-2"
						onClick={() => onChange(t.clear)}
						size="sm"
						title={`取消「${t.title} ${t.value}」`}
						variant="secondary"
					>
						<span className="min-w-0 flex-1 truncate text-start">
							{t.value}
						</span>
						<XIcon className="shrink-0 text-muted-foreground" />
					</Button>
				</section>
			))}

			{fields.map((field) => (
				<FilterFacet field={field} key={field.key} onChange={onChange} />
			))}
		</div>
	);
}

/**
 * 一维分面：一个 `Fieldset`，维名是它的 `legend`——读屏走到里面任何一项，都会
 * 先报出这一项属于哪一维，而「P7」这种取值离开维名就没有意思。
 *
 * 控件由 `field.multi` 挑（为什么由它挑见文件开头）：能多选的是一组复选框，
 * 只能选一个的是一组单选加一枚「不限」。
 */
function FilterFacet({
	field,
	onChange,
}: {
	field: FilterField;
	onChange: (next: Partial<View>) => void;
}) {
	const [all, setAll] = useState(false);
	if (field.options.length === 0) return null;

	const head = collapse(field);
	const rest = field.options.filter((o) => !head.includes(o));

	const rows = (options: FilterField["options"]) =>
		options.map((o) => (
			<Option
				/* 数到 0 的行留着但点不动：它说的是「这个值存在，只是和你现在的
				   筛选冲突」。选中的那一行永远点得动，否则就取消不掉了。 */
				disabled={o.n === 0 && !field.values.includes(o.value)}
				key={o.value}
				multi={field.multi}
				n={o.n}
				value={o.value}
			>
				{o.label}
			</Option>
		));

	const list = (
		<>
			{rows(head)}
			{rest.length > 0 && (
				/* 剩下那几项住在 `Collapsible` 的面里：面自己有高度过渡，展开是同一
				   块东西长开，不是凭空多出来几行把整条栏往下顶一屏；关着的时候面
				   根本不挂载，那几十项也就不进 DOM。收起来的那一路必须也在——
				   只能展开的话，按一次就再没有东西能把这一栏收回去。 */
				<Collapsible onOpenChange={setAll} open={all}>
					<CollapsiblePanel>{rows(rest)}</CollapsiblePanel>
					<CollapsibleTrigger
						className="w-full justify-start px-2 text-muted-foreground data-panel-open:[&_svg]:rotate-180"
						render={<Button size="sm" variant="ghost" />}
					>
						<ChevronDownIcon />
						{all ? "收起" : `更多 ${rest.length} 项`}
					</CollapsibleTrigger>
				</Collapsible>
			)}
		</>
	);

	return (
		/* `min-w-0`：`<fieldset>` 自带 `min-inline-size: min-content`，不解掉的话
		   一个长技能名就能把整条栏撑出横向滚动。 */
		<Fieldset className="flex min-w-0 flex-col gap-1">
			<FieldsetLegend className="label px-2 pb-1 text-muted-foreground">
				{field.title}
			</FieldsetLegend>
			{/* `FieldItem` 要有一个 `Field.Root` 才成立（禁用态从这条链下去），
			    这一层就是它；维名归上面那个 `legend`，所以它自己不带标签。 */}
			<Field className="gap-0">
				{field.multi ? (
					<CheckboxGroup
						className="w-full gap-0"
						onValueChange={(next) => onChange(field.set(next.map(String)))}
						value={field.values}
					>
						{list}
					</CheckboxGroup>
				) : (
					<RadioGroup
						className="w-full gap-0"
						onValueChange={(next) =>
							onChange(field.set(next ? [String(next)] : []))
						}
						value={field.values[0] ?? ""}
					>
						{/*
						 * 单选维要有一条写出来的出路：圆点按下去不会弹起来，所以
						 * 「这一维不筛」必须自己占一行，不能靠「把选中的那一项再点
						 * 一次」这种只有点过才知道的暗号。它还顺带把这一维的默认态
						 * 摆上了屏幕。它不报人数：它不是一个筛选，没有「点了还剩
						 * 几个人」可言。
						 */}
						<Option multi={false} n={null} value="">
							不限
						</Option>
						{list}
					</RadioGroup>
				)}
			</Field>
		</Fieldset>
	);
}

/**
 * 一个候选。一行里三段：勾（或圆点）、取值、点了还剩几个人。
 *
 * 整行是 `FieldLabel`，所以点哪儿都算——命中区不必自己撑，`<label>` 本来就
 * 管着它包住的那个控件。禁用也归 `FieldItem`：勾和字一起变灰，不用自己去配
 * 一套「看起来像禁用」的类。
 */
function Option({
	children,
	disabled,
	multi,
	n,
	value,
}: {
	children: React.ReactNode;
	disabled?: boolean;
	multi: boolean;
	/** 点了还剩多少人。`null` 是「这一项没有这个数」（「不限」那一行）。 */
	n: number | null;
	value: string;
}) {
	return (
		<FieldItem className="px-2" disabled={disabled}>
			<FieldLabel className="w-full cursor-pointer py-1.5">
				{multi ? <Checkbox value={value} /> : <Radio value={value} />}
				<span className="min-w-0 flex-1 truncate">{children}</span>
				{/* 人数右对齐、等宽数字：一列数字竖着比，才看得出点哪个收得最狠 */}
				{n !== null && (
					<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
						{n}
					</span>
				)}
			</FieldLabel>
		</FieldItem>
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
