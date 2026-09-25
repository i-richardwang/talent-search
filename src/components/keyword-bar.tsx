import { SearchIcon } from "lucide-react";
import { useImperativeHandle, useRef, useState, useTransition } from "react";
import { Button } from "#/components/ui/button";
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxItem,
	ComboboxList,
	ComboboxPopup,
	ComboboxStatus,
	ComboboxValue,
} from "#/components/ui/combobox";
import { Field, FieldDescription, FieldLabel } from "#/components/ui/field";
import { Form } from "#/components/ui/form";
import {
	NumberField,
	NumberFieldDecrement,
	NumberFieldGroup,
	NumberFieldIncrement,
	NumberFieldInput,
	NumberFieldScrubArea,
} from "#/components/ui/number-field";
import { Spinner } from "#/components/ui/spinner";
import {
	type Condition,
	conditionKey,
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
	const whatInput = useRef<HTMLInputElement>(null);

	useImperativeHandle(ref, () => ({
		focus: () => whatInput.current?.focus(),
	}));

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
			className="flex w-full flex-col gap-4"
			onSubmit={async (event) => {
				event.preventDefault();
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
			<TermBox {...box("what")} autoFocus={autoFocus} inputRef={whatInput} />
			<div className="grid gap-4 sm:grid-cols-[2fr_2fr_1fr]">
				<TermBox {...box("org")} />
				<TermBox {...box("school")} />
				{/* coss 的 Field + NumberField 组合（p-field-17）：标签是 NumberField 自己的
				    ScrubArea，左右拖也能改数。 */}
				<Field>
					<NumberField
						disabled={noWhat}
						min={0.5}
						onValueChange={setYears}
						step={0.5}
						value={years}
					>
						<NumberFieldScrubArea label="累计年限（至少）" />
						<NumberFieldGroup>
							<NumberFieldDecrement />
							<NumberFieldInput placeholder="不限" />
							<NumberFieldIncrement />
						</NumberFieldGroup>
					</NumberField>
					<FieldDescription>
						{noWhat ? "请先填写经历或技能" : "每项经历分别计算"}
					</FieldDescription>
				</Field>
			</div>
			<div>
				<Button disabled={same} loading={busy} type="submit">
					<SearchIcon />
					搜索
				</Button>
			</div>
		</Form>
	);
}

/**
 * 一个框：已选的词是 chip，敲字时下拉。照 Base UI 的 Async search (multiple)
 * 示例的做法：候选随敲字向服务端要（`suggestTerms`，所以 `filter={null}`，这里不
 * 过滤），换了字就作废上一问；已选的词留在列表里带勾，点一下去掉；查询中和
 * 出错说在 `ComboboxStatus` 里。
 *
 * Combobox 本身只收列表里有的项，框里却要能加库里没有的写法：列表第一项永远是
 * 敲的这几个字本身（Base UI Creatable 示例的做法），回车就加上它。
 */
function TermBox({
	field,
	values,
	onValuesChange,
	typed,
	onTypedChange,
	autoFocus,
	inputRef,
}: {
	field: KeywordField;
	values: string[];
	onValuesChange: (values: string[]) => void;
	typed: string;
	onTypedChange: (text: string) => void;
	autoFocus?: boolean;
	inputRef?: React.Ref<HTMLInputElement>;
}) {
	const [found, setFound] = useState<Suggestion[]>([]);
	const [failed, setFailed] = useState(false);
	const [pending, startTransition] = useTransition();
	const asking = useRef<AbortController | null>(null);
	const q = typed.trim();
	const full = values.length >= VALUES_MAX;

	function ask(text: string, reason: string) {
		onTypedChange(text);
		asking.current?.abort();
		const needle = text.trim();
		// 选中一项时 Base UI 也会清空输入，那不是一次新的问
		if (!needle || full || reason === "item-press") {
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

	const asTyped = accepts(q) && !values.includes(q) && !full ? q : null;
	const people = new Map(found.map((s) => [s.value, s.people]));
	const items = [
		...(asTyped ? [asTyped] : []),
		...(full
			? []
			: found
					.map((s) => s.value)
					.filter((v) => v !== asTyped && !values.includes(v))),
		...values,
	];

	const status = pending ? (
		<span className="inline-flex items-center gap-2">
			<Spinner />
			正在查找
		</span>
	) : failed ? (
		"暂无建议，可直接添加。"
	) : full ? (
		`最多 ${VALUES_MAX} 个，请先移除一个。`
	) : !q && values.length === 0 ? (
		"输入关键词，从建议中选择。"
	) : null;

	return (
		<Field className="min-w-0">
			<FieldLabel>{KEYWORD_LABEL[field]}</FieldLabel>
			<Combobox
				autoHighlight
				filter={null}
				inputValue={typed}
				items={items}
				multiple
				onInputValueChange={(text, { reason }) => ask(text, reason)}
				onValueChange={(next: string[]) => {
					onValuesChange(next);
					onTypedChange("");
				}}
				value={values}
			>
				<ComboboxChips>
					<ComboboxValue>
						{(chosen: string[]) => (
							<>
								{chosen.map((v) => (
									<ComboboxChip
										aria-label={v}
										key={v}
										removeProps={{ "aria-label": `移除 ${v}` }}
									>
										{v}
									</ComboboxChip>
								))}
								<ComboboxChipsInput
									autoFocus={autoFocus}
									placeholder={chosen.length > 0 ? undefined : "输入关键词"}
									ref={inputRef}
								/>
							</>
						)}
					</ComboboxValue>
				</ComboboxChips>
				<ComboboxPopup aria-busy={pending || undefined}>
					<ComboboxStatus>{status}</ComboboxStatus>
					<ComboboxList>
						{(item: string) => {
							const n = people.get(item);
							const note =
								item === asTyped
									? AS_TYPED[field]
									: n != null
										? `${n} 人`
										: null;
							return (
								<ComboboxItem key={item} value={item}>
									<span className="flex items-baseline justify-between gap-3">
										<span className="min-w-0 truncate">{item}</span>
										{note && (
											<span className="shrink-0 text-muted-foreground text-xs">
												{note}
											</span>
										)}
									</span>
								</ComboboxItem>
							);
						}}
					</ComboboxList>
				</ComboboxPopup>
			</Combobox>
			<FieldDescription>{FIELD_HINT[field]}</FieldDescription>
		</Field>
	);
}
