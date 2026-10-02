/** 查询理解的领域校验：校验整张条件表、核对词表取值并沿用停用状态；条件与说明分别保存。 */
import { z } from "zod";
import {
	type Condition,
	conditionKey,
	type ExperienceCondition,
	MODES,
	PERSON_FIELDS,
	PERSON_MODES,
	withOff,
} from "./condition";
import { isOrdinal, isVocabKey, type VocabKey } from "./dimensions";
import { type SearchSpec, sanitizeSpec } from "./spec";
import { boundedText } from "./text";

/** 模型选择词表取值时只能看语料真实拥有的词表。哪几维有词表见 `VOCAB_KEYS`。 */
export type Vocabulary = { [K in VocabKey]: readonly string[] };

const experienceItem = z.object({
	about: z.literal("experience"),
	mode: z
		.enum(MODES)
		.describe("must=必须；boost=最好有；exclude=不要这样的经历"),
	what: z
		.array(z.string())
		.optional()
		.describe("做过什么，任一命中即可；不限就不写"),
	org: z
		.array(z.string())
		.optional()
		.describe("在哪家公司或哪个部门，任一即可；不限就不写"),
	companyTag: z
		.array(z.string())
		.optional()
		.describe("在哪一档公司，从给出的取值里挑；不限就不写"),
	kind: z
		.enum(["internal", "external"])
		.optional()
		.describe("internal=公司内的任职；external=入职前的经历；不限就不写"),
	minMonths: z
		.number()
		.int()
		.optional()
		.describe("这样的经历累计至少多少个月；不限就不写"),
});

const personItem = z.object({
	about: z.literal("person"),
	mode: z.enum(PERSON_MODES).describe("must=必须；boost=最好是"),
	field: z.enum(PERSON_FIELDS),
	values: z
		.array(z.string())
		.optional()
		.describe("任一即可；词表维从给出的取值里挑"),
	atLeast: z
		.string()
		.optional()
		.describe("这一档及以上，只用于 level 和 education，从给出的取值里挑一档"),
});

const conditionItems = z.array(
	z.discriminatedUnion("about", [experienceItem, personItem]),
);

/** 提交工具的回答形状。词表由提示词提供，数量与文本上限在 condition.ts 校验。 */
export const submissionSchema = z.object({
	conditions: conditionItems.describe(
		"整张新的条件表。一条经历主张里的各项说的是同一段经历；不同的经历分别写一条",
	),
	assumed: z
		.array(z.string())
		.describe("你替用户选定的读法，一句一条；没有就空着"),
	declined: z
		.array(
			z.object({
				said: z.string().describe("用户的原话片段"),
				why: z.string().describe("为什么搜不了：库里有什么、没有什么"),
				instead: conditionItems.describe(
					"能换成库里有的说法就写成条件，换不了就空着",
				),
			}),
		)
		.describe("这句话里搜不了的要求；没有就空着"),
});

/** 模型提交的一份搜索条件：符合 schema，还没经过 `understood` 校验。 */
export type Submission = z.infer<typeof submissionSchema>;

/**
 * 模型给出的一条「搜不了」：原话、原因、可以换成的条件。
 * `instead` 已经过和条件表同一道校验，界面上点一下就能加进查询。
 */
type Declined = { said: string; why: string; instead: Condition[] };

/**
 * 一次理解的说明，只属于写出它的那条记录。条件表是查询本身，说明是对这一轮的
 * 交代：替用户做了哪些假设、哪些要求搜不了。两样都没有时不落库（`null`）。
 */
export type TurnNotes = { assumed: string[]; declined: Declined[] };

/** 说明里每一类最多几条。再多就不是交代，是一段需要人读完才能继续的正文。 */
const NOTES_MAX = 3;

/** 一次理解校验之后的样子：新的条件表，和这一轮的说明。 */
type Understood = { spec: SearchSpec; notes: TurnNotes | null };

/**
 * 模型输出 → 这一轮的新查询与说明。不合规的取值局部丢弃，不牵连整句。
 *
 * 只多做两件 `conditionsOf` 做不了的事：
 *
 * 1. **词表维的取值必须在词表里。** 模型是唯一会写出词表外取值的来源（「资深」
 *    对不上任何一档职级），RPC 那一侧的取值来自屏幕上的候选。
 * 2. **停用状态跟着条件走。** 模型写不出停用（schema 里没有这一栏），提交的
 *    条件和上一轮某一条完全相同时，那一条的停用原样带过来：用户停掉的不会因为
 *    又说了一句话就复活，因为太宽被停用的也不会。
 */
export function understood(
	raw: unknown,
	vocab: Vocabulary,
	base: readonly Condition[],
): Understood {
	const value = (raw ?? {}) as Record<string, unknown>;
	const validate = (list: unknown) => conditionsIn(list, vocab);
	const offs = new Map(base.map((c) => [conditionKey(c), c.off ?? null]));
	const conditions = validate(value.conditions).map((c) =>
		withOff(c, offs.get(conditionKey(c)) ?? null),
	);
	const assumed = textsOf(value.assumed);
	const declined: Declined[] = [];
	for (const item of Array.isArray(value.declined) ? value.declined : []) {
		const entry = (item ?? {}) as Record<string, unknown>;
		const said = boundedText(entry.said);
		const why = boundedText(entry.why);
		// 同一段原话只交代一次：两行一样的「搜不了」说不出第二件事
		if (!said || !why || declined.some((d) => d.said === said)) continue;
		declined.push({ said, why, instead: validate(entry.instead) });
		if (declined.length === NOTES_MAX) break;
	}
	return {
		spec: { conditions },
		notes:
			assumed.length > 0 || declined.length > 0 ? { assumed, declined } : null,
	};
}

function textsOf(raw: unknown): string[] {
	const out: string[] = [];
	for (const item of Array.isArray(raw) ? raw : []) {
		const text = boundedText(item);
		if (text && !out.includes(text)) out.push(text);
		if (out.length === NOTES_MAX) break;
	}
	return out;
}

/** 一列不可信的条件 → 校验过、词表维取值都在词表里的条件。 */
function conditionsIn(raw: unknown, vocab: Vocabulary): Condition[] {
	const items = Array.isArray(raw) ? raw : [];
	const inVocab = (key: VocabKey, list: unknown) =>
		(Array.isArray(list) ? list : [])
			.map(boundedText)
			.filter((t): t is string => t !== undefined && vocab[key].includes(t));
	const conditions = items.flatMap((item) => {
		const entry = (item ?? {}) as Record<string, unknown>;
		// 停用只由上一轮带过来，模型那一侧写的一律不认
		const { off: _off, ...rest } = entry;
		if (rest.about === "experience")
			return [{ ...rest, companyTag: inVocab("companyTag", rest.companyTag) }];
		if (rest.about !== "person" || !isVocabKey(rest.field)) return [rest];
		const key = rest.field;
		if (!isOrdinal(key) || rest.atLeast === undefined)
			return [{ ...rest, values: inVocab(key, rest.values) }];
		// 「及以上」的那一档不在词表里，整条不认：只丢这一档，它就读成了列举，换了意思
		const [atLeast] = inVocab(key, [rest.atLeast]);
		return atLeast ? [{ ...rest, atLeast }] : [];
	});
	return sanitizeSpec({ conditions }).conditions;
}

/**
 * 这次理解算不算作答了。不算的返回原因，调用方据此显式失败、可重试。
 *
 * 丢掉**单个**取值是设计内的：一个词表外的档、一个太长的词，丢掉比放行强。
 * 两种情况不是：
 *
 * - 模型给了条件，校验后**一条不剩**：它整体没按约定作答。让查询带着一份空条件
 *   走下去，界面会画成「这句话里没有能找人的条件」，也就是把一次故障画成了用户
 *   的问题。
 * - 条件表空着，说明也空着：一句话要么能写成条件，要么说得出为什么写不了。
 *   什么都没写的是没作答，不是「成功但没有条件」。
 */
export function unanswered(raw: unknown, result: Understood): string | null {
	const value = (raw ?? {}) as Record<string, unknown>;
	const asked = Array.isArray(value.conditions) ? value.conditions.length : 0;
	if (result.spec.conditions.length > 0) return null;
	if (asked > 0)
		return `查询理解给出的条件全部不合规，校验后一个不剩：${JSON.stringify(
			value.conditions,
		).slice(0, 400)}`;
	if (!result.notes) return "查询理解既没有给出条件，也没有说明为什么";
	return null;
}

/**
 * 一份提交的搜索条件里，词表维写了词表外取值的地方，每处一句话，告诉模型去改。
 * 最后仍在词表外的取值由 `understood` 丢掉；先告诉模型，它就有机会换成词表里的那一档。
 */
export function valuesOutsideVocabulary(
	submitted: Submission,
	vocab: Vocabulary,
): string[] {
	const out = new Set<string>();
	const check = (key: VocabKey, values: readonly string[]) => {
		for (const v of values)
			if (!vocab[key].includes(v))
				out.add(
					`${key} 没有「${v}」这个取值，可选：${vocab[key].join("、") || "（无）"}`,
				);
	};
	for (const c of [
		...submitted.conditions,
		...submitted.declined.flatMap((d) => d.instead),
	]) {
		if (c.about === "experience") check("companyTag", c.companyTag ?? []);
		else if (isVocabKey(c.field))
			check(c.field, [...(c.values ?? []), ...(c.atLeast ? [c.atLeast] : [])]);
	}
	return [...out];
}

/** 要检查经历词是否太宽的条件：正向的、写了经历词的。 */
type WidthChecked = ExperienceCondition &
	Required<Pick<ExperienceCondition, "what">>;

/**
 * 哪些条件要检查经历词是否太宽：这一轮新写出来的正向主张。
 *
 * 上一轮已经有的不检查：它检查过了，或者用户看过、坚持要用。只检查正向的：太宽说的是
 * 「它筛不掉人」，而排除说的是「哪一段经历不算数」，命中的人多正说明它在起作用；
 * 而且排除按更高的相关度门槛判断，算出来的宽度不适用于它。
 */
export function needsWidthCheck(
	base: readonly Condition[],
): (c: Condition) => c is WidthChecked {
	const had = new Set(base.map(conditionKey));
	return (c): c is WidthChecked =>
		c.about === "experience" &&
		c.mode !== "exclude" &&
		c.what !== undefined &&
		!had.has(conditionKey(c));
}
