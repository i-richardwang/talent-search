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
import type { Matched } from "./trace";

/**
 * 模型选择词表取值时只能看语料真实拥有的词表，每个取值带着有这个值的人数。
 * 哪几维有词表见 `VOCAB_KEYS`。
 */
export type Vocabulary = { [K in VocabKey]: readonly Matched[] };

function has(vocab: Vocabulary, key: VocabKey, value: string) {
	return vocab[key].some((v) => v.name === value);
}

const experienceItem = z.object({
	about: z.literal("experience"),
	mode: z
		.enum(MODES)
		.meta({ description: "must=必须；boost=最好有；exclude=不要这样的经历" }),
	what: z
		.array(z.string())
		.optional()
		.meta({ description: "做过什么，任一命中即可；不限就不写" }),
	company: z
		.array(z.string())
		.optional()
		.meta({ description: "入职前在哪家公司，任一即可；不限就不写" }),
	department: z
		.array(z.string())
		.optional()
		.meta({ description: "公司内在哪个部门，任一即可；不限就不写" }),
	companyTag: z
		.array(z.string())
		.optional()
		.meta({ description: "在哪一档公司，从给出的取值里挑；不限就不写" }),
	kind: z.enum(["internal", "external"]).optional().meta({
		description: "internal=公司内的任职；external=入职前的经历；不限就不写",
	}),
	minMonths: z
		.int()
		.optional()
		.meta({ description: "这样的经历累计至少多少个月；不限就不写" }),
});

const personItem = z.object({
	about: z.literal("person"),
	mode: z.enum(PERSON_MODES).meta({ description: "must=必须；boost=最好是" }),
	field: z.enum(PERSON_FIELDS),
	values: z
		.array(z.string())
		.optional()
		.meta({ description: "任一即可；词表维从给出的取值里挑" }),
	atLeast: z.string().optional().meta({
		description:
			"这一档及以上，只用于 level 和 education，从给出的取值里挑一档",
	}),
});

const conditionItems = z.array(
	z.discriminatedUnion("about", [experienceItem, personItem]),
);

/** 提交工具的回答形状。词表由提示词提供，数量与文本上限在 condition.ts 校验。 */
export const submissionSchema = z.object({
	conditions: conditionItems.meta({
		description:
			"整张新的条件表。一条经历主张里的各项说的是同一段经历；不同的经历分别写一条",
	}),
	note: z
		.object({
			says: z.string().meta({ description: "对 HR 说的一句话" }),
			current: z.string().nullable().meta({
				description:
					"有选项时，现在这张表是哪种理解，写成 HR 会回的话；没有选项写 null",
			}),
			options: z
				.array(
					z.object({
						label: z.string().meta({ description: "HR 选这一项时会回的话" }),
						detail: z
							.string()
							.meta({ description: "一句说明，人数来自查到的结果" }),
						conditions: conditionItems.meta({
							description: "选了这一项之后的整张条件表",
						}),
					}),
				)
				.meta({ description: "HR 还可以换成的理解；没有就空着" }),
		})
		.nullable()
		.meta({
			description: "名单上看不出、要 HR 知道或拿主意的一件事；没有就写 null",
		}),
});

/** 模型提交的一份搜索条件：符合 schema，还没经过 `understood` 校验。 */
export type Submission = z.infer<typeof submissionSchema>;

/** HR 可以换成的一种理解。`conditions` 已经过和条件表同一道校验，选它就是换成这张表。 */
export type Choice = {
	label: string;
	detail?: string;
	conditions: Condition[];
};

/**
 * 一次理解给 HR 的一句话，只属于写出它的那条记录。名单已经按条件表出来了，这句话只说名单上
 * 看不出的：哪些要求人才库里没有，或者一个词有几种理解、现在按的是哪种。HR 还可以换成别的理解时
 * 带上选项，`current` 是现在这张表的那一种。没有要说的时候不写入（`null`）。
 */
export type TurnNotes = {
	says: string;
	choices: { current: string; others: Choice[] } | null;
};

/** 除了现在这一种，最多再给几种理解。再多 HR 就得读完一屏才能选。 */
const OTHERS_MAX = 2;

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
 *    又说了一句话就复活。
 *
 * 说明里每个选项的整张表走同一道校验（`notesOf`）。
 */
export function understood(
	raw: unknown,
	vocab: Vocabulary,
	base: readonly Condition[],
): Understood {
	const value = (raw ?? {}) as Record<string, unknown>;
	const offs = new Map(base.map((c) => [conditionKey(c), c.off ?? null]));
	const validate = (list: unknown) =>
		conditionsIn(list, vocab).map((c) =>
			withOff(c, offs.get(conditionKey(c)) ?? null),
		);
	const conditions = validate(value.conditions);
	return {
		spec: { conditions },
		notes: notesOf(value.note, conditions, validate),
	};
}

/**
 * 模型写的说明 → 写入的说明。选项校验后和现在的表一样、和前面的选项一样，或者一条都不剩，
 * 就不算一种理解；没写现在是哪种理解时整组选项不用：HR 分不清点了会换成什么。
 */
function notesOf(
	raw: unknown,
	conditions: readonly Condition[],
	validate: (list: unknown) => Condition[],
): TurnNotes | null {
	const note = (raw ?? {}) as Record<string, unknown>;
	const says = boundedText(note.says);
	if (!says) return null;
	const seen = new Set([tableKey(conditions)]);
	const others: Choice[] = [];
	for (const item of Array.isArray(note.options) ? note.options : []) {
		const entry = (item ?? {}) as Record<string, unknown>;
		const label = boundedText(entry.label);
		const table = validate(entry.conditions);
		const key = tableKey(table);
		if (!label || table.length === 0 || seen.has(key)) continue;
		seen.add(key);
		const detail = boundedText(entry.detail);
		others.push({ label, ...(detail && { detail }), conditions: table });
		if (others.length === OTHERS_MAX) break;
	}
	const current = boundedText(note.current);
	return {
		says,
		choices: current && others.length > 0 ? { current, others } : null,
	};
}

/** 一张条件表的身份：同样几条，不论先后。 */
function tableKey(conditions: readonly Condition[]) {
	return JSON.stringify(conditions.map(conditionKey).sort());
}

/** 一列不可信的条件 → 校验过、词表维取值都在词表里的条件。 */
function conditionsIn(raw: unknown, vocab: Vocabulary): Condition[] {
	const items = Array.isArray(raw) ? raw : [];
	const inVocab = (key: VocabKey, list: unknown) =>
		(Array.isArray(list) ? list : [])
			.map(boundedText)
			.filter((t): t is string => t !== undefined && has(vocab, key, t));
	const conditions = items.flatMap((item) => {
		const entry = (item ?? {}) as Record<string, unknown>;
		// 停用只由上一轮带过来，模型那一侧写的都不认
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
			if (!has(vocab, key, v))
				out.add(
					`${key} 没有「${v}」这个取值，可选：${vocab[key].map((x) => x.name).join("、") || "（无）"}`,
				);
	};
	for (const c of [
		...submitted.conditions,
		...(submitted.note?.options ?? []).flatMap((o) => o.conditions),
	]) {
		if (c.about === "experience") check("companyTag", c.companyTag ?? []);
		else if (isVocabKey(c.field))
			check(c.field, [...(c.values ?? []), ...(c.atLeast ? [c.atLeast] : [])]);
	}
	return [...out];
}

type NewClaim = ExperienceCondition &
	Required<Pick<ExperienceCondition, "what">>;

/**
 * 哪些条件要检查经历词找不找得到人：这一轮新写出来的正向主张。
 *
 * 上一轮已经有的不检查：它检查过了，或者用户看过、坚持要用。排除不检查：它按更高的
 * 相关度门槛判断，查词工具给的人数不适用于它。
 */
export function isNewClaim(
	base: readonly Condition[],
): (c: Condition) => c is NewClaim {
	const had = new Set(base.map(conditionKey));
	return (c): c is NewClaim =>
		c.about === "experience" &&
		c.mode !== "exclude" &&
		c.what !== undefined &&
		!had.has(conditionKey(c));
}
