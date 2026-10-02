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
import { Text } from "#/components/ui/text";
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
import type { Suggestion } from "#/search/result";
import { suggestTerms } from "#/server/functions";

export type KeywordBarHandle = {
	/** 把光标放进「经历或技能」。 */
	focus: () => void;
};

type NameField = Exclude<KeywordField, "what">;

/** 候选第一项（输入的字本身）旁的说明：经历按语义搜，名称按包含找。 */
const AS_TYPED: Record<KeywordField, string> = {
	what: "直接搜索",
	org: "名称包含",
	school: "名称包含",
};

const NAME_ICON: Record<NameField, LucideIcon> = {
	org: Building2Icon,
	school: GraduationCapIcon,
};

/** 累计年限的几档。填回来的值不在其中时，它自己也列进去。 */
const YEAR_STEPS = [1, 2, 3, 5, 10];

const accepts = (text: string) => termOf(text) !== undefined;

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
 * 关键词搜索的查询面：托盘里写经历或技能，公司或部门、学校、累计年限是动作栏上的按钮。
 * 词在各维之间怎么组合写在 `search/keywords.ts`。发送时还没回车的那个词也算数。
 */
export function KeywordBar({
	initial = NO_KEYWORDS,
	onSearch,
	size = "middle",
	left,
	autoFocus = false,
	ref,
}: {
	/** 框里一开始的词；没改动时发送钮按不下去。 */
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

/** 公司或部门、学校：弹层收起时，框里还没回车的字按回车处理。 */
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

/** 累计年限挂在每个经历或技能上、各自累计，所以没有经历或技能时按不下去。 */
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
 * 一维的框：已加的词、输入框和提醒，怎么摆由调用处经 `children` 定。
 *
 * 候选由服务端按输入给（所以 `filter={null}`），换了字就作废上一问；第一项是输入的字本身，
 * 不在候选里的写法也能加。AutoComplete 选中一项时会把它填进输入框，这里拦下 `item-press`
 * 那次改字，改成加词并清空。没有高亮项时回车加输入的字；输入框空着时回车交给表单提交。
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

	/** 加不上时说为什么，字留在框里。 */
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
				<Text className="min-w-0" ellipsis>
					{value}
				</Text>
				{note && (
					<Text className="shrink-0" size="xs" type="secondary">
						{note}
					</Text>
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
