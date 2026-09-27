import {
	Building2Icon,
	CheckIcon,
	ClockIcon,
	GraduationCapIcon,
	Loader2,
	type LucideIcon,
} from "lucide-react";
import {
	type ReactNode,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	useTransition,
} from "react";
import { AutoComplete } from "#/components/ui/auto-complete";
import {
	ChatInput,
	ChatInputAction,
	ChatInputBar,
	ChatInputBody,
	ChatInputPlaceholder,
	ChatInputSend,
} from "#/components/ui/chat-input";
import {
	DropdownMenuHeader,
	DropdownMenuItemContent,
	DropdownMenuItemIcon,
	DropdownMenuItemLabel,
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItemIndicator,
	DropdownMenuRadioItemPrimitive,
	DropdownMenuRoot,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Hotkey } from "#/components/ui/hotkey";
import { Icon } from "#/components/ui/icon";
import { Popover } from "#/components/ui/popover";
import { Tag } from "#/components/ui/tag";
import { cn } from "#/lib/utils";
import {
	type Condition,
	conditionKey,
	MAX_TERM_LEN,
	MIN_TERM_LEN,
	termOf,
	VALUES_MAX,
} from "#/search/condition";
import {
	conditionsOfKeywords,
	KEYWORD_LABEL,
	type KeywordField,
	type Keywords,
	NO_KEYWORDS,
} from "#/search/keywords";
import { suggestTerms } from "#/server/functions";
import type { Suggestion } from "#/server/suggest";

export type KeywordBarHandle = {
	/** 把光标放进「经历或技能」。工作台的「/」和空态的出路落到这里。 */
	focus: () => void;
};

/** 名称的两维：动作栏上各一个按钮，点开是它自己的框。 */
type NameField = Exclude<KeywordField, "what">;

/** 下拉里那条「就按输入的这几个字」怎么说：经历按语义直接搜，名称按包含找。 */
const AS_TYPED: Record<KeywordField, string> = {
	what: "直接搜索",
	org: "名称包含",
	school: "名称包含",
};

/** 名称两维按钮上的图标。 */
const NAME_ICON: Record<NameField, LucideIcon> = {
	org: Building2Icon,
	school: GraduationCapIcon,
};

/** 累计年限的几档。结果页填回来的值不在这几档里时，它自己也列进去。 */
const YEAR_STEPS = [1, 2, 3, 5, 10];

/** 敲着的字算不算一个词：和收窄同一道（`termOf`），不收的就不给加。 */
const accepts = (text: string) => termOf(text) !== undefined;

/** 加上一段敲着的字：算一个词、还没有、没加满才加。 */
function plus(values: string[], text: string) {
	const t = text.trim();
	return accepts(t) && !values.includes(t) && values.length < VALUES_MAX
		? [...values, t]
		: values;
}

const identity = (conditions: readonly Condition[]) =>
	conditions.map(conditionKey).join("\n");

const monthsOf = (years: number | null) =>
	years != null && years > 0 ? Math.round(years * 12) : null;

/**
 * 关键词模式的查询面：和 AI 搜索同一块输入托盘。托盘里写经历或技能，词一个个变成标签；
 * 公司或部门、学校、累计年限是动作栏上的按钮，前两个点开是各自的框，年限点开是菜单。
 * 一维一个框，按钮上写着这一维现在填了什么。词在各维之间怎么组合写在
 * `search/keywords.ts`。
 *
 * 首页（large，动作栏左端是搜索方式的切换 `left`）和关键词搜索的结果页（middle）用的
 * 是它：结果页把当前的词填回来（`initial`），改完再按发送派生一条新记录，浏览器后退
 * 就是撤销。托盘里空着时回车就是搜索，敲着还没回车的那个词也算数。职级、学历这些
 * 有限取值的维不在这里，在结果页导航栏的筛选里，带着人数勾。
 */
export function KeywordBar({
	initial = NO_KEYWORDS,
	onSearch,
	size = "middle",
	left,
	autoFocus = false,
	ref,
}: {
	/** 框里一开始的词。结果页是当前这次搜索的词：没改动时发送钮按不下去。 */
	initial?: Keywords;
	onSearch: (conditions: Condition[]) => boolean | Promise<boolean>;
	size?: "middle" | "large";
	left?: ReactNode;
	autoFocus?: boolean;
	ref?: React.Ref<KeywordBarHandle>;
}) {
	const [picked, setPicked] = useState<Keywords>(initial);
	const [typed, setTyped] = useState("");
	const [years, setYears] = useState<number | null>(
		initial.minMonths ? initial.minMonths / 12 : null,
	);
	const [busy, setBusy] = useState(false);
	const whatBox = useRef<HTMLDivElement>(null);

	useImperativeHandle(ref, () => ({
		focus: () => whatBox.current?.querySelector("input")?.focus(),
	}));

	useEffect(() => {
		if (autoFocus) whatBox.current?.querySelector("input")?.focus();
	}, [autoFocus]);

	const keywords: Keywords = {
		...picked,
		what: plus(picked.what, typed),
		minMonths: monthsOf(years),
	};
	const conditions = conditionsOfKeywords(keywords);
	const same = identity(conditions) === identity(conditionsOfKeywords(initial));
	const setField = (field: KeywordField) => (values: string[]) =>
		setPicked((k) => ({ ...k, [field]: values }));

	return (
		<form
			onSubmit={async (event) => {
				event.preventDefault();
				if (same || busy) return;
				setBusy(true);
				try {
					if (await onSearch(conditions)) {
						setPicked(keywords);
						setTyped("");
					}
				} finally {
					setBusy(false);
				}
			}}
		>
			<ChatInput size={size}>
				<ChatInputBody>
					<TermEntry
						field="what"
						onTypedChange={setTyped}
						onValuesChange={setField("what")}
						typed={typed}
						values={picked.what}
						variant="borderless"
					>
						{({ input, tags, note }) => (
							<>
								<div
									className="flex min-w-0 flex-wrap items-center gap-1"
									ref={whatBox}
								>
									{tags}
									{input}
								</div>
								{picked.what.length === 0 && !typed && (
									<ChatInputPlaceholder
										hint={
											<span className="inline-flex items-center">
												按<Hotkey keys="enter" variant="borderless" />
												添加，多个需同时满足
											</span>
										}
									>
										输入经历或技能，例如：推荐算法
									</ChatInputPlaceholder>
								)}
								{note && (
									<p className="pb-1 text-fg-secondary text-xs">{note}</p>
								)}
							</>
						)}
					</TermEntry>
				</ChatInputBody>
				<ChatInputBar
					left={
						<>
							{left}
							{(["org", "school"] as const).map((field) => (
								<NameButton
									field={field}
									key={field}
									onValuesChange={setField(field)}
									values={picked[field]}
								/>
							))}
							<YearsMenu
								disabled={keywords.what.length === 0}
								onChange={setYears}
								value={years}
							/>
						</>
					}
					right={
						<ChatInputSend aria-label="搜索" disabled={same} loading={busy} />
					}
				/>
			</ChatInput>
		</form>
	);
}

/**
 * 公司或部门、学校：动作栏上的一个按钮，上面写着填了什么（没填时是这一维的名字），
 * 点开是这一维自己的框。框里敲着还没回车的字，收起时按回车处理：算一个词就加上。
 */
function NameButton({
	field,
	values,
	onValuesChange,
}: {
	field: NameField;
	values: string[];
	onValuesChange: (values: string[]) => void;
}) {
	const [typed, setTyped] = useState("");
	const label = KEYWORD_LABEL[field];
	const shown =
		values.length === 0
			? label
			: values.length === 1
				? values[0]
				: `${values[0]} 等 ${values.length} 个`;
	return (
		<Popover
			content={
				<div className="flex w-72 flex-col gap-2">
					<TermEntry
						field={field}
						onTypedChange={setTyped}
						onValuesChange={onValuesChange}
						placeholder={`输入${label}，回车添加`}
						typed={typed}
						values={values}
						variant="filled"
					>
						{({ input, tags, note }) => (
							<>
								{input}
								<p
									className={cn(
										"text-xs",
										note ? "text-fg-secondary" : "text-fg-tertiary",
									)}
								>
									{note ?? "满足任一即可"}
								</p>
								{values.length > 0 && (
									<div className="flex flex-wrap gap-1">{tags}</div>
								)}
							</>
						)}
					</TermEntry>
				</div>
			}
			onOpenChange={(open) => {
				if (open) return;
				onValuesChange(plus(values, typed));
				setTyped("");
			}}
			placement="bottomLeft"
			trigger="click"
		>
			<ChatInputAction
				aria-label={
					values.length > 0 ? `${label}：${values.join("、")}` : label
				}
				chevron
				icon={NAME_ICON[field]}
			>
				{shown}
			</ChatInputAction>
		</Popover>
	);
}

/**
 * 累计年限：动作栏上的一个菜单，按钮上写着现在是几年。挂在每个经历或技能上、各自累计，
 * 所以没有经历或技能时按不下去。
 */
function YearsMenu({
	value,
	onChange,
	disabled,
}: {
	value: number | null;
	onChange: (years: number | null) => void;
	disabled: boolean;
}) {
	const steps =
		value === null || YEAR_STEPS.includes(value)
			? YEAR_STEPS
			: [...YEAR_STEPS, value].sort((a, b) => a - b);
	const label = (years: number | null) =>
		years === null ? "不限" : `至少 ${years} 年`;
	return (
		<DropdownMenuRoot>
			<DropdownMenuTrigger>
				<ChatInputAction
					aria-label={`累计年限：${label(value)}`}
					chevron
					disabled={disabled}
					icon={ClockIcon}
					title={disabled ? "先填经历或技能" : undefined}
				>
					{value === null ? "累计年限" : label(value)}
				</ChatInputAction>
			</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuPositioner>
					<DropdownMenuPopup>
						<DropdownMenuHeader className="text-fg-secondary text-xs">
							每个经历或技能分别累计
						</DropdownMenuHeader>
						<DropdownMenuRadioGroup
							onValueChange={(next) =>
								onChange(next === "" ? null : Number(next))
							}
							value={value === null ? "" : String(value)}
						>
							{[null, ...steps].map((years) => (
								<DropdownMenuRadioItemPrimitive
									key={years ?? "none"}
									label={label(years)}
									value={years === null ? "" : String(years)}
								>
									<DropdownMenuItemContent>
										<DropdownMenuItemIcon>
											<DropdownMenuRadioItemIndicator>
												<Icon icon={CheckIcon} />
											</DropdownMenuRadioItemIndicator>
										</DropdownMenuItemIcon>
										<DropdownMenuItemLabel>
											{label(years)}
										</DropdownMenuItemLabel>
									</DropdownMenuItemContent>
								</DropdownMenuRadioItemPrimitive>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuPopup>
				</DropdownMenuPositioner>
			</DropdownMenuPortal>
		</DropdownMenuRoot>
	);
}

/**
 * 一维的框：已加的词（可关闭的标签）、敲字的框（`AutoComplete`）和下面那行提醒，
 * 怎么摆由调用处经 `children` 定。经历或技能在托盘里，标签和无框的输入排在一行；
 * 名称两维在按钮的弹层里，上面是输入框，下面是几个词之间怎么算（或提醒），再下面是标签。
 *
 * 候选随敲字向服务端要（`suggestTerms`，所以 `filter={null}`，本地不按字过滤），换了字
 * 就作废上一问。列表第一项是敲的这几个字本身，旁边说明按它怎么搜；库里没有的写法也能加。
 *
 * 选中一项（点、轻点，或方向键高亮后回车）就把它加成一个词：Autocomplete 选中时默认
 * 把那一项填进输入框；这里接住 `item-press` 那次改字，加词并清空输入。没有高亮项时回车
 * 加敲的字；托盘里空着时回车交给表单，就是搜索。敲的字不算一个词（太短或太长）时留在
 * 框里，下面一行说为什么。输入框空着时退格删最后一个词。查询中框尾转圈；查询出错、
 * 加满了也在下面一行说。
 */
function TermEntry({
	field,
	values,
	onValuesChange,
	typed,
	onTypedChange,
	variant,
	placeholder = "",
	children,
}: {
	field: KeywordField;
	values: string[];
	onValuesChange: (values: string[]) => void;
	typed: string;
	onTypedChange: (text: string) => void;
	variant: "borderless" | "filled";
	placeholder?: string;
	/** 怎么摆由调用处定：拿到输入框、标签和提醒（没有时是 null）。 */
	children: (parts: {
		input: ReactNode;
		tags: ReactNode;
		note: string | null;
	}) => ReactNode;
}) {
	const [found, setFound] = useState<Suggestion[]>([]);
	const [failed, setFailed] = useState(false);
	const [open, setOpen] = useState(false);
	const [highlighted, setHighlighted] = useState(false);
	const [rejected, setRejected] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const asking = useRef<AbortController | null>(null);
	const q = typed.trim();
	const full = values.length >= VALUES_MAX;

	function ask(text: string) {
		onTypedChange(text);
		setRejected(null);
		asking.current?.abort();
		const needle = text.trim();
		if (!needle || full) {
			setFound([]);
			setFailed(false);
			return;
		}
		const controller = new AbortController();
		asking.current = controller;
		startTransition(async () => {
			setFailed(false);
			try {
				const list = await suggestTerms({
					data: { field, q: needle },
					signal: controller.signal,
				});
				if (controller.signal.aborted) return;
				startTransition(() => setFound(list));
			} catch {
				if (controller.signal.aborted) return;
				startTransition(() => {
					setFound([]);
					setFailed(true);
				});
			}
		});
	}

	/** 把一段字加成一个词；加不上时说为什么，字留在框里。 */
	function add(text: string) {
		const t = text.trim();
		const term = termOf(t);
		if (!term) {
			setRejected(
				t.length < MIN_TERM_LEN
					? `「${t}」太短，至少 ${MIN_TERM_LEN} 个字。`
					: `「${t.slice(0, 8)}…」太长，最多 ${MAX_TERM_LEN} 个字。`,
			);
			return;
		}
		if (full) return;
		if (!values.includes(term)) onValuesChange([...values, term]);
		setHighlighted(false);
		ask("");
	}

	const asTyped = accepts(q) && !values.includes(q) && !full ? q : null;
	const option = (value: string, note: string | null) => ({
		label: (
			<span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
				<span className="min-w-0 truncate">{value}</span>
				{note && (
					<span className="shrink-0 text-fg-secondary text-xs">{note}</span>
				)}
			</span>
		),
		value,
	});
	const options = [
		...(asTyped ? [option(asTyped, AS_TYPED[field])] : []),
		...(full ? [] : found)
			.filter((s) => s.value !== asTyped && !values.includes(s.value))
			.map((s) => option(s.value, s.people != null ? `${s.people} 人` : null)),
	];

	const shown = open && options.length > 0;

	const note =
		rejected ??
		(failed
			? "暂无建议，可直接回车添加。"
			: full
				? `最多 ${VALUES_MAX} 个，请先移除一个。`
				: null);

	const tags = values.map((v) => (
		<Tag
			closable
			key={v}
			onClose={() => onValuesChange(values.filter((x) => x !== v))}
		>
			{v}
		</Tag>
	));

	const input = (
		// 没有高亮项时的回车由这里加词；有高亮项时交给 Autocomplete 选中它
		<div
			className="min-w-32 flex-1"
			onKeyDownCapture={(event) => {
				if (event.nativeEvent.isComposing) return;
				if (event.key === "Enter" && !(shown && highlighted) && q) {
					event.preventDefault();
					event.stopPropagation();
					add(typed);
				} else if (event.key === "Backspace" && !typed && values.length > 0) {
					onValuesChange(values.slice(0, -1));
				}
			}}
		>
			<AutoComplete
				aria-label={KEYWORD_LABEL[field]}
				filter={null}
				onChange={(text, details) =>
					details.reason === "item-press" ? add(text) : ask(text)
				}
				onItemHighlighted={(item) => setHighlighted(item !== undefined)}
				onOpenChange={setOpen}
				open={shown}
				options={options}
				placeholder={placeholder}
				suffix={pending ? <Icon icon={Loader2} size="small" spin /> : undefined}
				value={typed}
				variant={variant}
			/>
		</div>
	);

	return children({ input, note, tags });
}
