/**
 * 一条**查询条件**，以及把不可信输入收窄成它的边界。
 *
 * 查询在模型嘴里、在 RPC 上、在库里、在屏幕上只有这一种形状：一个条件数组。
 * 模型的任务是**写这条搜索**，用户在 chip 上改的也是它，评估拿它做 diff。
 * 三个读者读的是同一个对象，中间没有翻译。
 *
 * HR 找人的一句话里只有两种东西，条件因此也只有两种：
 *
 * - **经历主张**（`about: "experience"`）：这个人有一段（或几段）经历，**同时**
 *   满足写下的每一项——做过什么（`what`）、在哪（`org` / `companyTag`）、
 *   什么时候（`kind`）、多久（`minMonths`，满足其余各项的段累计的月数）。
 *   少写的项就是不限：只有 `what` 是今天最常见的经历词，只有 `org` 是「待过字节」。
 * - **人的条件**（`about: "person"`）：这个人本身是什么样——职级、学历、
 *   招聘渠道、学校。一人一个值，和哪段经历都没关系。
 *
 *     { about: "experience", mode: "must", what: ["增长", "用户增长"],
 *       companyTag: ["大厂"], kind: "external", minMonths: 36 }
 *     { about: "experience", mode: "boost", org: ["字节"] }
 *     { about: "person", mode: "boost", field: "level", values: ["D7", "D8"] }
 *
 * 执行语义只有两句：**一条主张之内是同一段经历，条件之间是同一个人。** 修饰语挂在
 * 哪个动词上由模型在读句子时决定，「在字节做推荐」和「做过推荐，也待过字节」是
 * 两份不同的查询，屏幕上看得出来、改得动。
 *
 * **搜索词是模型对「要找什么人」的表达，不是用户的原话。** 用户说「搞推荐的」，
 * 模型写「推荐算法」「推荐系统」，找人更准，屏幕上也看得懂。取值不标来源、
 * 不按来源打折、不让模型把原话交回来核对：那些东西服务的读者不存在。
 *
 * 库里表达不了的条件不解释，直接不写：软化成排序信号，或者不管。「资深」是
 * 职级上的一条 boost；「北京的」库里没有，就不写。
 */
import {
	DIMENSIONS,
	type DimUnit,
	dimId,
	textList,
	type VOCAB_KEYS,
} from "./dimensions";
import { boundedText } from "./text";

/**
 * 一条条件的强度。
 *
 * - `must`：这个人必须满足。多条 must 之间是 AND。
 * - `boost`：满足了排前面，不满足也留在结果里。「这个人还得会点 X」和
 *   「会 X 更好」之间的差别，招聘里这两句话不是一句话。
 * - `exclude`：只对经历主张有意义。命中它的**经历段**丧失为任何主张作证的资格。
 *   否决的是证据，不是人——实习起步、后来真干了八年算法的人留下，因为他有
 *   别的硬证据；只有那段实习的人自然出不来，因为他没有证据了。
 *   人的条件没有排除：「不要校招的」在这套维度里该说成「社招」。
 */
export const MODES = ["must", "boost", "exclude"] as const;
export type Mode = (typeof MODES)[number];
/** 人的条件能有的强度：没有排除。 */
export const PERSON_MODES = ["must", "boost"] as const;
export type PersonMode = (typeof PERSON_MODES)[number];

/** 人的条件能落在哪几维：有词表的三维是 `employee` 上的列，学校名是自由文本。 */
export const PERSON_FIELDS = [
	"level",
	"education",
	"recruitment",
	"school",
] as const;
export type PersonField = (typeof PERSON_FIELDS)[number];
/** 人的条件里属于 `dimensions.ts` 那张表的几维；学校名不在表里。 */
export type PersonDim = Exclude<PersonField, "school">;

type Kind = DimUnit["kind"];

/**
 * 一条条件为什么被停用。
 *
 * `user` 是用户在 chip 上点的：这条还在查询里、还画在屏幕上，但这一次检索
 * 完全当它不存在。招聘检索是反复试的——加一条发现只剩三个人，想知道是不是
 * 它太窄。删掉再手打回来会丢掉它的强度，也丢掉「我试过这个」这件事。
 *
 * `wide` 是理解落库时量出来的：这条主张的经历词在语料里命中的人太多
 * （`WIDE_SHARE`），几乎筛不掉人。成因写在这里，界面据此说「太宽」而不是
 * 一个无缘无故的停用；用户可以换词，也可以坚持启用。
 */
const OFF_CAUSES = ["user", "wide"] as const;
type OffCause = (typeof OFF_CAUSES)[number];

type Some<T> = readonly [T, ...T[]];

export type ExperienceCondition = {
	about: "experience";
	mode: Mode;
	/** 做过什么。取值 OR，都拿去比相似度；`what[0]` 是代表词。 */
	what?: Some<string>;
	/** 在名字含这几个字之一的公司或部门。专有名词，永远不进向量。 */
	org?: Some<string>;
	/** 在这几档公司之一。取值是词表里的档。 */
	companyTag?: Some<string>;
	/** 公司内的任职，还是入职前的经历。 */
	kind?: Kind;
	/** 满足其余各项的段累计至少这么多个月。 */
	minMonths?: number;
	off?: OffCause;
};

export type PersonCondition = {
	about: "person";
	mode: PersonMode;
	field: PersonField;
	/** 取值 OR。词表维写的是词表里的档，学校写名字。 */
	values: Some<string>;
	off?: OffCause;
};

export type Condition = ExperienceCondition | PersonCondition;

function isPersonDim(field: PersonField): field is PersonDim {
	return field !== "school";
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
export const CONDITION_MAX = 12;

/**
 * 一条主张最多几个经历词。再多就不是一条主张了。
 *
 * 词表维不用这个数：「资深」在一份三条职级序列的词表上就是十几档，截到六档等于
 * 把其中一条序列整个丢掉。它们的上限是一维能同时选中几项（`FILTER_LIST_MAX`），
 * 和 URL 上的筛选同一条。
 */
export const VALUES_MAX = 6;

/** 一列不可信的经历词 → 去重、限长、限个数之后的那几个。 */
function whatOf(raw: unknown): string[] {
	const out: string[] = [];
	for (const item of Array.isArray(raw) ? raw : []) {
		const text = termOf(item);
		if (text && !out.includes(text)) out.push(text);
		if (out.length === VALUES_MAX) break;
	}
	return out;
}

/**
 * 一列不可信的取值 → 词表维上的取值，写成这一维自己的身份（`dimId`）。
 * 读不回来的丢掉：一个「资深」在屏幕上画得出来、在检索里却不筛任何人，那是
 * 一个说谎的 chip。取值在不在**词表**里这里不查——RPC 这一侧没有词表，而模型
 * 那一侧是唯一会写出词表外取值的来源，它多一道检查（`intent.ts`）。
 */
function dimList<K extends (typeof VOCAB_KEYS)[number]>(
	key: K,
	raw: unknown,
): string[] {
	const picked = DIMENSIONS[key].parse(raw);
	return (picked ?? []).map((v) => dimId(key, v));
}

function some(list: readonly string[] | undefined): Some<string> | undefined {
	return list && list.length > 0
		? (list as unknown as Some<string>)
		: undefined;
}

/**
 * 不可信的一份条件列表 → 收窄后的条件。模型输出和 RPC 入参走的是同一个口子：
 * 两边的不可信程度一样，上游声明过 schema 也省不掉这一道。
 *
 * 不合规的取值局部丢弃，不牵连整条；一项都不剩的条件整条消失。完全相同的
 * 条件只留第一条。人的条件没有排除（`PERSON_MODES`），带着排除的整条丢掉。
 */
export function conditionsOf(raw: unknown): Condition[] {
	const list: Condition[] = [];
	const seen = new Set<string>();
	for (const item of Array.isArray(raw) ? raw : []) {
		const entry = (item ?? {}) as Record<string, unknown>;
		const mode = MODES.includes(entry.mode as Mode)
			? (entry.mode as Mode)
			: "must";
		const off = OFF_CAUSES.includes(entry.off as OffCause)
			? (entry.off as OffCause)
			: undefined;
		const condition =
			entry.about === "experience"
				? experienceOf(entry, mode)
				: entry.about === "person" && isPersonMode(mode)
					? personOf(entry, mode)
					: null;
		if (!condition) continue;
		const key = conditionKey(condition);
		if (seen.has(key)) continue;
		seen.add(key);
		list.push(off ? { ...condition, off } : condition);
		if (list.length === CONDITION_MAX) break;
	}
	return list;
}

function experienceOf(
	entry: Record<string, unknown>,
	mode: Mode,
): ExperienceCondition | null {
	const what = some(whatOf(entry.what));
	const org = some(textList(entry.org));
	const companyTag = some(dimList("companyTag", entry.companyTag));
	const kind = DIMENSIONS.kind.parse(entry.kind);
	const minMonths = DIMENSIONS.minMonths.parse(entry.minMonths);
	if (!what && !org && !companyTag && !kind && !minMonths) return null;
	return {
		about: "experience",
		mode,
		...(what && { what }),
		...(org && { org }),
		...(companyTag && { companyTag }),
		...(kind && { kind }),
		...(minMonths && { minMonths }),
	};
}

function isPersonMode(mode: Mode): mode is PersonMode {
	return (PERSON_MODES as readonly Mode[]).includes(mode);
}

function personOf(
	entry: Record<string, unknown>,
	mode: PersonMode,
): PersonCondition | null {
	const field = String(entry.field) as PersonField;
	if (!(PERSON_FIELDS as readonly string[]).includes(field)) return null;
	const values = some(
		isPersonDim(field) ? dimList(field, entry.values) : textList(entry.values),
	);
	return values ? { about: "person", mode, field, values } : null;
}

/** 条件的身份：它说的是什么、多强。停用与否不算——那是同一条条件的两种状态。 */
export function conditionKey(condition: Condition): string {
	const { off: _off, ...rest } = condition;
	return JSON.stringify(rest);
}

/** 把停用的那些去掉。检索、证据行、分面都只看这一份。 */
export function activeConditions(list: readonly Condition[]): Condition[] {
	return list.filter((c) => !c.off);
}

/** 停用或启用一条条件。强度与取值原样留着——停用不是重写。 */
export function withOff(condition: Condition, off: OffCause | null): Condition {
	const { off: _off, ...rest } = condition;
	return off ? ({ ...rest, off } as Condition) : (rest as Condition);
}

/** 这条条件允许的几档强度：人的条件没有排除（见 `MODES`）。 */
export function modesOf(condition: Condition): readonly Mode[] {
	return condition.about === "experience" ? MODES : PERSON_MODES;
}

/** 改一条条件的强度。这条给不了的强度不改——调用方拿到的是原样的它。 */
export function withMode(condition: Condition, mode: Mode): Condition {
	return modesOf(condition).includes(mode)
		? ({ ...condition, mode } as Condition)
		: condition;
}

/**
 * 一条条件里可以单独拿掉的一项。经历主张的每个经历词、每个公司名、每个公司档
 * 各是一项，`kind` 与 `minMonths` 各是一项；人的条件的每个取值是一项。
 * chip 的菜单按它逐项画「去掉」。
 */
export type Part =
	| { key: "what" | "org" | "companyTag" | "values"; value: string }
	| { key: "kind"; value: Kind }
	| { key: "minMonths"; value: number };

/** 一条条件拆成可以单独拿掉的几项，按屏幕上显示的顺序。 */
export function partsOf(condition: Condition): Part[] {
	if (condition.about === "person")
		return condition.values.map((value) => ({ key: "values", value }));
	const parts: Part[] = [];
	if (condition.kind) parts.push({ key: "kind", value: condition.kind });
	for (const value of condition.companyTag ?? [])
		parts.push({ key: "companyTag", value });
	for (const value of condition.org ?? []) parts.push({ key: "org", value });
	for (const value of condition.what ?? []) parts.push({ key: "what", value });
	if (condition.minMonths)
		parts.push({ key: "minMonths", value: condition.minMonths });
	return parts;
}

/**
 * 拿掉一项。拿到一项不剩就是删掉整条，返回 `null`——一条什么都没说的条件
 * 在屏幕上画不出来，在检索里也没有意义。
 */
export function withoutPart(
	condition: Condition,
	part: Part,
): Condition | null {
	if (condition.about === "person") {
		const values = some(condition.values.filter((v) => v !== part.value));
		return values ? { ...condition, values } : null;
	}
	const next: ExperienceCondition = { ...condition };
	if (part.key === "kind") delete next.kind;
	else if (part.key === "minMonths") delete next.minMonths;
	else if (part.key !== "values") {
		const kept = some(next[part.key]?.filter((v) => v !== part.value));
		if (kept) next[part.key] = kept;
		else delete next[part.key];
	}
	return partsOf(next).length > 0 ? next : null;
}

/** 这份查询里的经历主张。 */
export function experienceConditions(list: readonly Condition[]) {
	return list.filter((c): c is ExperienceCondition => c.about === "experience");
}
