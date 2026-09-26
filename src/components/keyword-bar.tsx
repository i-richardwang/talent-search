import { Loader2, SearchIcon } from "lucide-react";
import {
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	useTransition,
} from "react";
import { AutoComplete } from "#/components/ui/auto-complete";
import { Button } from "#/components/ui/button";
import { Form } from "#/components/ui/form";
import { Icon } from "#/components/ui/icon";
import { InputNumber } from "#/components/ui/input";
import { Tag } from "#/components/ui/tag";
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

/** 框里敲着、还没变成 chip 的字。 */
type Typed = Record<KeywordField, string>;
const NOTHING_TYPED: Typed = { what: "", org: "", school: "" };

/** 下拉里那条「就按输入的这几个字」怎么说：经历按语义直接搜，名称按包含找。 */
const AS_TYPED: Record<KeywordField, string> = {
	what: "直接搜索",
	org: "名称包含",
	school: "名称包含",
};

const FIELD_HINT: Record<KeywordField, string> = {
	what: "需同时满足",
	org: "满足任一即可",
	school: "满足任一即可",
};

/** 敲着的字算不算一个词：和收窄同一道（`termOf`），不收的就不给加。 */
const accepts = (text: string) => termOf(text) !== undefined;

/** 框里的词，加上每个框里敲着还没回车的那一个——点「搜索」时它们也算数。 */
function withTyped(k: Keywords, typed: Typed): Keywords {
	const more = (field: KeywordField) => {
		const text = typed[field].trim();
		return accepts(text) && !k[field].includes(text) ? [text] : [];
	};
	return {
		...k,
		what: [...k.what, ...more("what")],
		org: [...k.org, ...more("org")],
		school: [...k.school, ...more("school")],
	};
}

const identity = (conditions: readonly Condition[]) =>
	conditions.map(conditionKey).join("\n");

const monthsOf = (years: number | null) =>
	years != null && years > 0 ? Math.round(years * 12) : null;

/**
 * 关键词模式的查询面：一个框管一维，框里的词是 chip，敲字时下拉给出库里真有的写法。
 * 词在框之间怎么组合写在 `search/keywords.ts`。
 *
 * 首页和关键词搜索的结果页用的是它：结果页把当前的词填回来（`initial`），改完
 * 再按「搜索」派生一条新记录，浏览器后退就是撤销。职级、学历这些有限取值的维不在
 * 这里，在结果页左边的筛选栏，带着人数勾。
 */
export function KeywordBar({
	initial = NO_KEYWORDS,
	onSearch,
	autoFocus = false,
	ref,
}: {
	/** 框里一开始的词。结果页是当前这次搜索的词：没改动时「搜索」按不下去。 */
	initial?: Keywords;
	onSearch: (conditions: Condition[]) => boolean | Promise<boolean>;
	autoFocus?: boolean;
	ref?: React.Ref<KeywordBarHandle>;
}) {
	const [picked, setPicked] = useState<Keywords>(initial);
	const [typed, setTyped] = useState<Typed>(NOTHING_TYPED);
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

	const keywords = withTyped({ ...picked, minMonths: monthsOf(years) }, typed);
	const conditions = conditionsOfKeywords(keywords);
	const same = identity(conditions) === identity(conditionsOfKeywords(initial));
	const noWhat = keywords.what.length === 0;

	const box = (field: KeywordField) => ({
		field,
		values: picked[field],
		onValuesChange: (values: string[]) =>
			setPicked((k) => ({ ...k, [field]: values })),
		typed: typed[field],
		onTypedChange: (text: string) => setTyped((t) => ({ ...t, [field]: text })),
	});

	return (
		<Form
			gap={0}
			layout="vertical"
			onFormSubmit={async () => {
				if (same || busy) return;
				setBusy(true);
				try {
					if (await onSearch(conditions)) {
						setPicked(keywords);
						setTyped(NOTHING_TYPED);
					}
				} finally {
					setBusy(false);
				}
			}}
		>
			<TermBox {...box("what")} boxRef={whatBox} />
			<div className="grid gap-x-4 sm:grid-cols-[2fr_2fr_1fr]">
				<TermBox {...box("org")} />
				<TermBox {...box("school")} />
				<Form.Field
					desc={noWhat ? "请先填写经历或技能" : "每项经历分别计算"}
					label="累计年限（至少）"
				>
					<InputNumber
						disabled={noWhat}
						min={0.5}
						onChange={setYears}
						placeholder="不限"
						step={0.5}
						value={years}
					/>
				</Form.Field>
			</div>
			<div>
				<Button
					disabled={same}
					htmlType="submit"
					icon={SearchIcon}
					loading={busy}
					type="primary"
				>
					搜索
				</Button>
			</div>
		</Form>
	);
}

/**
 * 一个框：上面是敲字的输入框（`AutoComplete`），下面是已选的词，每个词是一个可关闭的
 * 标签。候选随敲字向服务端要（`suggestTerms`，所以 `filter={null}`，本地不按字
 * 过滤），换了字就作废上一问。列表第一项是敲的这几个字本身，旁边说明按它怎么搜；
 * 库里没有的写法也能加。
 *
 * 选中一项（点、轻点，或方向键高亮后回车）就把它加成一个词：Autocomplete 选中时
 * 默认把那一项填进输入框；这里接住 `item-press` 那次改字，加词并清空输入。
 * 没有高亮项时回车加敲的字。敲的字不算一个词（太短或太长）时留在框里，说明里说
 * 为什么。输入框空着时退格删最后一个词。查询中框尾转圈；查询出错、加满了说在
 * 框下的说明里。
 */
function TermBox({
	field,
	values,
	onValuesChange,
	typed,
	onTypedChange,
	boxRef,
}: {
	field: KeywordField;
	values: string[];
	onValuesChange: (values: string[]) => void;
	typed: string;
	onTypedChange: (text: string) => void;
	boxRef?: React.Ref<HTMLDivElement>;
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

	const desc =
		rejected ??
		(failed
			? "暂无建议，可直接回车添加。"
			: full
				? `最多 ${VALUES_MAX} 个，请先移除一个。`
				: FIELD_HINT[field]);

	return (
		<Form.Field
			className="min-w-0"
			desc={desc}
			label={KEYWORD_LABEL[field]}
			ref={boxRef}
		>
			<div className="flex flex-col gap-2">
				{/* 没有高亮项时的回车由这里加词；有高亮项时交给 Autocomplete 选中它 */}
				<div
					onKeyDownCapture={(event) => {
						if (event.nativeEvent.isComposing) return;
						if (event.key === "Enter" && !(shown && highlighted) && q) {
							event.preventDefault();
							event.stopPropagation();
							add(typed);
						} else if (
							event.key === "Backspace" &&
							!typed &&
							values.length > 0
						) {
							onValuesChange(values.slice(0, -1));
						}
					}}
				>
					<AutoComplete
						filter={null}
						onChange={(text, details) =>
							details.reason === "item-press" ? add(text) : ask(text)
						}
						onItemHighlighted={(item) => setHighlighted(item !== undefined)}
						onOpenChange={setOpen}
						open={shown}
						options={options}
						placeholder="输入关键词"
						suffix={
							pending ? <Icon icon={Loader2} size="small" spin /> : undefined
						}
						value={typed}
					/>
				</div>
				{values.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{values.map((v) => (
							<Tag
								closable
								key={v}
								onClose={() => onValuesChange(values.filter((x) => x !== v))}
							>
								{v}
							</Tag>
						))}
					</div>
				)}
			</div>
		</Form.Field>
	);
}
