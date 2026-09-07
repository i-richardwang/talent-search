/**
 * 自然语言理解的可信边界。模型只负责把一句话路由成一份 SearchSpec；这里负责把
 * 不可信输出收窄成产品能够保存和执行的形状，不包含网络调用。
 */
import { z } from "zod";
import { parsePicked, type VocabKey } from "./dimensions";
import {
	boundedText,
	CHIP_MAX,
	CHIP_MODES,
	type ChipDraft,
	type ChipMode,
	canonical,
	termOf,
	toQuery,
} from "./parse";
import type { SearchScope, SearchSpec } from "./spec";

/** 模型选择结构化值时只能看语料真实拥有的词表。哪几维有词表见 `VOCAB_KEYS`。 */
export type Vocabulary = { [K in VocabKey]: readonly string[] };

function pick(values: readonly string[], description: string) {
	return (
		values.length > 0
			? z.enum(values as [string, ...string[]]).nullable()
			: z.null()
	).describe(description);
}

/**
 * 发给模型的输出形状。字段全部出现、以 null 表示未提及，兼容结构化输出端点的
 * 必填字段要求。词长只在描述里建议，真正的阈值由 `termOf` 单独负责。
 */
export function intentSchema(vocab: Vocabulary) {
	return z.object({
		terms: z
			.array(
				z.object({
					term: z
						.string()
						.describe(
							"一个方向、领域或能力，两到十二个字，写成库里岗位或序列会用的说法；缩写展开（BD → 商务拓展）",
						),
					mode: z
						.enum(CHIP_MODES)
						.describe(
							"must=必须做过；boost=最好有，没有也留下；exclude=这类经历不作数",
						),
					alts: z
						.array(z.string())
						.nullable()
						.describe(
							"用户明确说了「或 / 均可」的并列说法。没有就填 null，不要自行扩写同义词",
						),
				}),
			)
			.describe(`语义要求，按句子里出现的顺序，最多 ${CHIP_MAX} 条`),
		kind: z
			.enum(["internal", "external"])
			.nullable()
			.describe(
				"internal=只看当前公司的内部任职；external=只看加入当前公司之前的外部工作经历。没说就填 null",
			),
		minMonths: z
			.int()
			.min(1)
			.nullable()
			.describe("单段经历至少做满几个月。没说就填 null"),
		companyTag: pick(
			vocab.companyTag,
			"入职前待过的公司档，只能从给定取值里选。没说就填 null",
		),
		level: pick(
			vocab.level,
			"当前职级，只能选择一个精确取值。范围说法（如 P7 以上）或无法映射的头衔放进 unsupported",
		),
		recruitment: pick(
			vocab.recruitment,
			"招聘渠道，只能从给定取值里选。没说就填 null",
		),
		education: pick(vocab.education, "学历，只能从给定取值里选。没说就填 null"),
		org: z
			.string()
			.nullable()
			.describe(
				"用户点名的公司或部门名，原样照抄。它是精确条件，不是语义要求。没说就填 null",
			),
		school: z
			.string()
			.nullable()
			.describe("用户点名的学校名，原样照抄。没说就填 null"),
		unsupported: z
			.array(z.string())
			.describe(
				"句子里表达了条件、但上面没有任何一栏能准确表示的片段。原样照抄，没有就填空数组",
			),
	});
}

/**
 * 一句话最多留几条「没处放的条件」。
 *
 * 它是载荷的闸，不是判断：这几条会原样存进不可变记录、随查询画在屏幕上，
 * 而模型输出异常时 `unsupported` 是最容易变成一整段正文的那一栏。八条已经比
 * 一句话里说得出的条件多了。
 */
const UNSUPPORTED_MAX = 8;

/** 模型输出 → 这句话的查询。任何不合规字段都被局部丢弃，不牵连整句。 */
export function toSpec(raw: unknown, vocab: Vocabulary): SearchSpec {
	const value = (raw ?? {}) as Record<string, unknown>;
	const drafts: ChipDraft[] = [];

	for (const item of Array.isArray(value.terms) ? value.terms : []) {
		const entry = (item ?? {}) as Record<string, unknown>;
		const term = termOf(entry.term);
		if (!term) continue;
		const mode = CHIP_MODES.includes(entry.mode as ChipMode)
			? (entry.mode as ChipMode)
			: "must";
		const alts = Array.isArray(entry.alts)
			? entry.alts.map(termOf).filter((x): x is string => x !== undefined)
			: [];
		drafts.push({ term, ...(alts.length > 0 && { alts }), mode });
	}

	/**
	 * 模型一维只给一个值——提示词就是这么要求的，而维度的取值形状是集合，所以
	 * 在这里裹成一项。要让模型改口产出并列取值，得改提示词并单独验模型行为，
	 * 那是模型侧的事，这一层给不出来。
	 */
	const listed = (input: unknown, values: readonly string[]) => {
		const candidate = boundedText(input);
		return candidate && values.includes(candidate) ? [candidate] : undefined;
	};
	const scope: SearchScope = {
		...parsePicked({
			kind: value.kind,
			minMonths: value.minMonths,
			companyTag: listed(value.companyTag, vocab.companyTag),
			level: listed(value.level, vocab.level),
			recruitment: listed(value.recruitment, vocab.recruitment),
			education: listed(value.education, vocab.education),
		}),
	};
	// 公司名、学校名和「没处放的条件」走的是和 URL、RPC 同一条边界
	// （`boundedText`）：模型输出是不可信输入，上游声明过 schema 不能省掉这一道。
	const org = boundedText(value.org);
	if (org) scope.org = org;
	const school = boundedText(value.school);
	if (school) scope.school = school;

	const unsupported = (
		Array.isArray(value.unsupported)
			? [
					...new Set(
						value.unsupported
							.map(boundedText)
							.filter((x): x is string => x !== undefined),
					),
				]
			: []
	).slice(0, UNSUPPORTED_MAX);

	return {
		evidence: canonical(toQuery(drafts)),
		scope,
		notices: unsupported.map((message) => ({
			kind: "unsupported" as const,
			text: message,
		})),
	};
}
