/**
 * 自然语言理解的可信边界。模型只负责把一句话路由成 SearchDelta；这里负责把
 * 不可信输出收窄成产品能够保存和执行的形状，不包含网络调用。
 */
import { z } from "zod";
import {
	CHIP_MAX,
	type Chip,
	type ChipMode,
	parseChips,
	parseQuery,
	toQuery,
} from "./parse";
import type { SearchDelta, SearchScope } from "./spec";

const MODES = ["must", "boost", "exclude"] as const;

/** 模型选择结构化值时只能看语料真实拥有的词表。 */
export type Vocabulary = {
	companyTags: readonly string[];
	levels: readonly string[];
	recruitments: readonly string[];
	educations: readonly string[];
};

function pick(values: readonly string[], description: string) {
	return (
		values.length > 0
			? z.enum(values as [string, ...string[]]).nullable()
			: z.null()
	).describe(description);
}

/**
 * 发给模型的输出形状。字段全部出现、以 null 表示未提及，兼容结构化输出端点的
 * 必填字段要求。词长只在描述里建议，真正的度量衡由 parseQuery 单独负责。
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
						.enum(MODES)
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
			vocab.companyTags,
			"入职前待过的公司档，只能从给定取值里选。没说就填 null",
		),
		level: pick(
			vocab.levels,
			"当前职级，只能选择一个精确取值。范围说法（如 P7 以上）或无法映射的头衔放进 unsupported",
		),
		recruitment: pick(
			vocab.recruitments,
			"招聘渠道，只能从给定取值里选。没说就填 null",
		),
		education: pick(
			vocab.educations,
			"学历，只能从给定取值里选。没说就填 null",
		),
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

function text(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 模型输出 → 一句话自己的查询增量。任何不合规字段都被局部丢弃，不牵连整句。 */
export function toDelta(raw: unknown, vocab: Vocabulary): SearchDelta {
	const value = (raw ?? {}) as Record<string, unknown>;
	const parseTexts = (input: unknown) =>
		Array.isArray(input)
			? input.flatMap((item) => parseQuery(text(item) ?? ""))
			: [];
	const drafts: Chip[] = [];

	for (const item of Array.isArray(value.terms) ? value.terms : []) {
		const term = (item ?? {}) as Record<string, unknown>;
		const mode = MODES.includes(term.mode as ChipMode)
			? (term.mode as ChipMode)
			: "must";
		const [head, ...rest] = parseQuery(text(term.term) ?? "");
		if (!head) continue;
		const alts = parseTexts(term.alts);
		drafts.push({ term: head, ...(alts.length > 0 && { alts }), mode });
		for (const part of rest) drafts.push({ term: part, mode });
	}

	const scope: SearchScope = {};
	if (value.kind === "internal" || value.kind === "external")
		scope.kind = value.kind;
	const months = Number(value.minMonths);
	if (Number.isInteger(months) && months > 0) scope.minMonths = months;
	const listed = (input: unknown, values: readonly string[]) => {
		const candidate = text(input);
		return candidate && values.includes(candidate) ? candidate : undefined;
	};
	const assignments: [keyof SearchScope, string | undefined][] = [
		["companyTag", listed(value.companyTag, vocab.companyTags)],
		["level", listed(value.level, vocab.levels)],
		["recruitment", listed(value.recruitment, vocab.recruitments)],
		["education", listed(value.education, vocab.educations)],
		["org", text(value.org)],
		["school", text(value.school)],
	];
	for (const [key, candidate] of assignments)
		if (candidate) Object.assign(scope, { [key]: candidate });

	const unsupported = Array.isArray(value.unsupported)
		? [...new Set(value.unsupported.map(text).filter((x): x is string => !!x))]
		: [];

	return {
		evidence: parseChips(toQuery(drafts)),
		scope,
		notices: unsupported.map((message) => ({
			kind: "unsupported" as const,
			text: message,
		})),
	};
}

/**
 * 模型不可用，或它没有留下任何信息时，用本地解析保住原话并显式记录降级。
 * unsupported-only 是完整且有意义的理解，不能被兜底改写成一条语义要求。
 */
export function resolveIntent(
	query: string,
	raw: unknown | null,
	vocab: Vocabulary,
): SearchDelta {
	if (raw !== null) {
		const delta = toDelta(raw, vocab);
		if (
			delta.evidence.length > 0 ||
			Object.keys(delta.scope).length > 0 ||
			delta.notices.length > 0
		)
			return delta;
	}
	return {
		evidence: parseChips(query),
		scope: {},
		notices: [{ kind: "fallback" }],
	};
}
