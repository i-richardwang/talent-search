/**
 * 查询的唯一表示：Term[]。模型输出、RPC、记录和界面共用 termsOf 的收窄边界。
 * 经历条件之间是 AND，一条条件的 values 是 OR。
 * 范围条件按维度、强度和停用状态归组；不同停用状态独立保留。
 * 搜索词表达要找的经历；无法用现有维度表达的条件不写入查询。
 */
import {
	DIMENSIONS,
	type DimKey,
	type DimUnit,
	dimId,
	dimPicked,
	FILTER_LIST_MAX,
	isMulti,
	VOCAB_KEYS,
} from "./dimensions";
import type { SearchScope } from "./spec";
import { boundedText } from "./text";

/**
 * 一条条件的强度。
 *
 * - `must`：这个人必须满足。多条 must 之间是 AND。
 * - `boost`：满足了排前面，不满足也留在结果里。「这个人还得会点 X」和
 *   「会 X 更好」之间的差别，招聘里这两句话不是一句话。
 * - `exclude`：只对经历词有意义。命中它的**经历段**丧失为任何条件作证的资格。
 *   否决的是证据，不是人——实习起步、后来真干了八年算法的人留下，因为他有
 *   别的硬证据；只有那段实习的人自然出不来，因为他没有证据了。
 *   范围维度没有排除：「不要校招的」在这套维度里该说成「社招」。
 */
export const TERM_MODES = ["must", "boost", "exclude"] as const;
export type TermMode = (typeof TERM_MODES)[number];

/**
 * 能当条件的**范围维度**：跟人走的公司名、学校名，有词表的四维，
 * 以及经历来源和经历时长。序列和能力词不在这里——序列要先知道整棵树，
 * 能力词就是经历词本身。
 */
export const SCOPE_FIELDS = [
	"org",
	"school",
	...VOCAB_KEYS,
	"kind",
	"minMonths",
] as const;
type ScopeField = (typeof SCOPE_FIELDS)[number];
/** 范围维度里属于 `dimensions.ts` 那张表的几维；公司名与学校名是自由文本，不在表里。 */
export type ScopeDim = Extract<ScopeField, DimKey>;

export const TERM_FIELDS = ["experience", ...SCOPE_FIELDS] as const;

/**
 * 一条条件为什么被停用。
 *
 * `user` 是用户在 chip 上点的：这条还在查询里、还画在屏幕上，但这一次检索
 * 完全当它不存在。招聘检索是反复试的——加一条发现只剩三个人，想知道是不是
 * 它太窄。删掉再手打回来会丢掉它的强度，也丢掉「我试过这个」这件事。
 *
 * `wide` 是理解落库时量出来的：这个词在语料里命中的人太多（`WIDE_SHARE`），
 * 几乎筛不掉谁。停用是可见的，成因写在这里，用户看得见、可以换词，也可以
 * 坚持启用（启用之后就是 `user` 那一档的反面：没有 `off`）。
 *
 * 没停用的条件身上不长这个字段：默认状态不该有记号。
 */
const OFF_CAUSES = ["user", "wide"] as const;
type OffCause = (typeof OFF_CAUSES)[number];

/**
 * 一条条件。`values` 是这一维上任一满足即可的几个取值：经历词是拿去嵌向量的
 * 文本，公司名与学校名是名字里含的字，其余几维是这一维的取值写成的字
 * （`scopeUnit` 读得回来；收窄时就保证了这一点，之后没有哪一处需要再问
 * 「这个取值解析得出来吗」）。
 *
 * `values[0]` 代表这条条件：屏幕上、证据行上、空态文案里都用它称呼这一条。
 * 先写的当代表，顺序本身就是信息。
 */
export type Term = Readonly<
	(
		| { field: "experience"; mode: TermMode }
		| { field: ScopeField; mode: Exclude<TermMode, "exclude"> }
	) & {
		values: readonly [string, ...string[]];
		off?: OffCause;
	}
>;

export function isScopeField(field: string): field is ScopeField {
	return (SCOPE_FIELDS as readonly string[]).includes(field);
}

export function isScopeDim(field: ScopeField): field is ScopeDim {
	return field !== "org" && field !== "school";
}

/**
 * 范围维度的一个取值（条件里的那串字）→ 这一维的一个取值。读不回来就不是
 * 这一维的取值：`"资深"` 不是职级，`"三年"` 不是月数。
 *
 * 全站只有这一处把条件里的字交给维度自己的 `parse`：收窄、执行、屏幕上怎么念
 * 都从这里读。集合维的 `parse` 收一列，单值维收一个，差别收在这里，调用方
 * 不必知道。
 */
export function scopeUnit<K extends ScopeDim>(
	key: K,
	value: string,
): DimUnit[K] | undefined {
	const parsed = DIMENSIONS[key].parse(isMulti(key) ? [value] : value);
	return dimPicked<K>(parsed)[0];
}

/**
 * 一个经历词最长几个字。上限住在这里，`intentSchema` 的描述里不写数字：
 * 写成 schema 约束的话，模型多给一个长词就是整条响应作废，而收窄只会丢掉那一个词。
 */
export const MAX_TERM_LEN = 24;

/** 一个经历词最短几个字。单字对语义匹配说不出任何东西。 */
const MIN_TERM_LEN = 2;

/**
 * 不可信的一段字 → 一个经历词，或者什么都不是。
 *
 * 只做边界工作——去两头空白、限长度——不改写字面：屏幕上写的那几个字和拿去
 * 比相似度的那几个字是同一串，改写发生在哪里都是一次看不见的查询变更。
 */
export function termOf(value: unknown): string | undefined {
	const text = boundedText(value);
	if (!text || text.length < MIN_TERM_LEN || text.length > MAX_TERM_LEN)
		return undefined;
	return text;
}

/** 一条查询最多几条条件。再多就不是一句话能说清的了。 */
export const TERM_MAX = 12;

/**
 * 一条经历条件最多几个词。再多就不是一条条件了。
 *
 * 范围维度不用这个数：「资深」在一份三条职级序列的词表上就是十几档，截到六档等于
 * 把其中一条序列整个丢掉。它们的上限是一维能同时选中几项（`FILTER_LIST_MAX`），
 * 和 URL 上的筛选同一条。
 */
export const VALUES_MAX = 6;

/**
 * 不可信的一份条件列表 → 收窄后的条件。模型输出和 RPC 入参走的是同一个口子：
 * 两边的不可信程度一样，上游声明过 schema 也省不掉这一道。
 *
 * 不合规的取值局部丢弃，不牵连整条；一个取值都不剩的条件整条消失。经历词
 * **跨条件去重**，先出现的赢：同一个词既必须又排除是自相矛盾的输入，与其猜
 * 用户想要哪个，不如让它保持第一次写下的样子，屏幕上看得见、改得动。
 * 范围条件在同维度、同强度、同停用状态内合并取值；单值维保留第一个取值。
 * 停用条件独立保留，修改另一条条件的强度不会改变它的启用状态。
 * 范围维度的 `exclude` 没有表示（见 `TERM_MODES`），整条丢掉。
 *
 * 范围维度的取值写成这一维自己的身份（`dimId`），读不回来的丢掉：一条
 * `minMonths` 写着「三年」在屏幕上画得出来、在检索里却不筛任何人，那是一枚
 * 说谎的 chip。取值在不在**词表**里这里不查——RPC 这一侧没有词表，而模型那一侧
 * 是唯一会写出词表外取值的来源，它多一道检查（`intent.ts`）。
 */
export function termsOf(raw: unknown): Term[] {
	const list: Term[] = [];
	const seen = new Set<string>();
	// 范围条件各组在列表里的位置
	const slot = new Map<string, number>();
	for (const item of Array.isArray(raw) ? raw : []) {
		const entry = (item ?? {}) as Record<string, unknown>;
		const field = String(entry.field);
		if (field !== "experience" && !isScopeField(field)) continue;
		const mode = TERM_MODES.includes(entry.mode as TermMode)
			? (entry.mode as TermMode)
			: "must";
		if (field !== "experience" && mode === "exclude") continue;
		const off = OFF_CAUSES.includes(entry.off as OffCause)
			? (entry.off as OffCause)
			: undefined;

		const capacity =
			field === "experience"
				? VALUES_MAX
				: isScopeDim(field) && !isMulti(field)
					? 1
					: FILTER_LIST_MAX;

		const values: string[] = [];
		for (const candidate of Array.isArray(entry.values) ? entry.values : []) {
			const text = writtenValue(field, candidate);
			if (!text || values.includes(text)) continue;
			if (field === "experience" && seen.has(text)) continue;
			values.push(text);
			if (values.length === capacity) break;
		}
		const [first, ...rest] = values;
		if (!first) continue;
		if (field === "experience") for (const v of values) seen.add(v);
		else {
			const key = `${field}\u0001${mode}\u0001${off ?? ""}`;
			const at = slot.get(key);
			if (at !== undefined) {
				const held = list[at] as Term;
				const merged: [string, ...string[]] = [...held.values];
				for (const v of values)
					if (merged.length < capacity && !merged.includes(v)) merged.push(v);
				list[at] = { ...held, values: merged } as Term;
				continue;
			}
			slot.set(key, list.length);
		}

		list.push({
			field,
			mode,
			values: [first, ...rest],
			...(off && { off }),
		} as Term);
		if (list.length === TERM_MAX) break;
	}
	return list;
}

/** 一个不可信的取值 → 这一维上它的写法，或者什么都不是。 */
function writtenValue(field: "experience" | ScopeField, raw: unknown) {
	if (field === "experience") return termOf(raw);
	const text = boundedText(raw);
	if (!text || !isScopeDim(field)) return text;
	const unit = scopeUnit(field, text);
	return unit === undefined ? undefined : dimId(field, unit);
}

/** 条件的完整身份，供同一查询中的 chip 区分彼此。 */
export function termKey(term: Term): string {
	return JSON.stringify([term.field, term.mode, term.values, term.off]);
}

/** 把停用的那些摘掉。检索、证据行、分面都只看这一份。 */
export function activeTerms(list: readonly Term[]): Term[] {
	return list.filter((t) => !t.off);
}

/** 停用或启用一条条件。强度与取值原样留着——停用不是重写。 */
export function withOff(term: Term, off: OffCause | null): Term {
	const { off: _off, ...rest } = term;
	return off ? ({ ...rest, off } as Term) : (rest as Term);
}

/** 这一维允许的几档强度：范围维度没有排除（见 `TERM_MODES`）。 */
export function modesOf(term: Term): readonly TermMode[] {
	return term.field === "experience"
		? TERM_MODES
		: TERM_MODES.filter((m) => m !== "exclude");
}

/** 改一条条件的强度。这一维给不了的强度不改——调用方拿到的是原样的它。 */
export function withMode(term: Term, mode: TermMode): Term {
	return modesOf(term).includes(mode) ? ({ ...term, mode } as Term) : term;
}

/**
 * 去掉一个取值。摘到一个不剩就是删掉整条，返回 `null`——
 * 一条没有取值的条件在屏幕上画不出来，在检索里也没有意义。
 */
export function withoutValue(term: Term, value: string): Term | null {
	const [first, ...rest] = term.values.filter((v) => v !== value);
	return first ? ({ ...term, values: [first, ...rest] } as Term) : null;
}

/** 这份查询里的经历词条件。 */
export function experienceTerms(list: readonly Term[]) {
	return list.filter(
		(t): t is Term & { field: "experience" } => t.field === "experience",
	);
}

/**
 * 这份查询里某一种语气的范围，摊成执行用的形状（`SearchScope`：和 URL 上的
 * 筛选同形，取数的 SQL 只认它）。启用的范围条件每维每档只有一条（`termsOf`），所以这里
 * 是逐条投影，没有合并。
 */
export function scopeOf(
	list: readonly Term[],
	mode: Exclude<TermMode, "exclude">,
): SearchScope {
	const scope: SearchScope = {};
	for (const term of activeTerms(list)) {
		if (term.field === "experience" || term.mode !== mode) continue;
		if (!isScopeDim(term.field)) {
			scope[term.field] = [...term.values];
			continue;
		}
		const key = term.field;
		const units = term.values.flatMap((v) => scopeUnit(key, v) ?? []);
		if (isMulti(key)) Object.assign(scope, { [key]: units });
		else if (units.length > 0) Object.assign(scope, { [key]: units[0] });
	}
	return scope;
}
