/**
 * 自然语言理解的可信边界。模型把一句话写成一份查询（`Condition[]`），这里把
 * 不可信的那份收窄成 `SearchSpec`；不包含网络调用。
 *
 * **模型的任务是写这条搜索，不是理解句子。** 它交出来的对象和用户在 chip 上
 * 改的、库里存的是同一个形状（为什么是这个形状，见 `condition.ts`），中间没有
 * 翻译：这里只做词表检查，其余收窄和 RPC 入参走同一道 `sanitizeSpec`。
 */
import { z } from "zod";
import { MODES, PERSON_FIELDS, PERSON_MODES } from "./condition";
import { VOCAB_KEYS, type VocabKey } from "./dimensions";
import { type SearchSpec, sanitizeSpec } from "./spec";
import { boundedText } from "./text";

/** 模型选择词表取值时只能看语料真实拥有的词表。哪几维有词表见 `VOCAB_KEYS`。 */
export type Vocabulary = { [K in VocabKey]: readonly string[] };

/**
 * 发给模型的输出形状：就是查询本身。**静态**：词表不进 schema，只在提示词里
 * 列一遍——同一份取值写两处就是两份契约；取值在不在词表里由 `toSpec` 查，
 * 查不过的取值丢掉，而不是整条响应作废。
 *
 * 每一项有自己的类型：月数是数字、经历来源是二选一、词表维各是一栏——模型看
 * schema 就知道填什么，不必读一段「这一维填什么样子」的说明。
 *
 * 这里的描述只说每一栏**是什么**，不写字数、条数这些上限：上限住在收窄那一处
 * （`condition.ts`），写进 schema 就是模型多给一个字整句失败。
 */
export const intentSchema = z.object({
	conditions: z
		.array(
			z.discriminatedUnion("about", [
				z.object({
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
						.describe(
							"internal=公司内的任职；external=入职前的经历；不限就不写",
						),
					minMonths: z
						.number()
						.int()
						.optional()
						.describe("这样的经历累计至少多少个月；不限就不写"),
				}),
				z.object({
					about: z.literal("person"),
					mode: z.enum(PERSON_MODES).describe("must=必须；boost=最好是"),
					field: z.enum(PERSON_FIELDS),
					values: z
						.array(z.string())
						.describe("任一即可；词表维从给出的取值里挑"),
				}),
			]),
		)
		.describe(
			"查询条件。一条经历主张里的各项说的是同一段经历；不同的经历分别写一条",
		),
});

/**
 * 模型输出 → 这句话的查询。不合规的取值局部丢弃，不牵连整句。
 *
 * 只多做一件 `conditionsOf` 做不了的事：**词表维的取值必须在词表里**。模型是
 * 唯一会写出词表外取值的来源（「资深」对不上任何一档职级），RPC 那一侧的取值
 * 来自屏幕上的候选。对不上的取值丢掉，一个不剩的项整项消失——搜索产品对
 * 说不清的条件就是不管，不解释。
 */
export function toSpec(raw: unknown, vocab: Vocabulary): SearchSpec {
	const value = (raw ?? {}) as Record<string, unknown>;
	const items = Array.isArray(value.conditions) ? value.conditions : [];
	const inVocab = (key: VocabKey, list: unknown) =>
		(Array.isArray(list) ? list : [])
			.map(boundedText)
			.filter((t): t is string => t !== undefined && vocab[key].includes(t));
	const conditions = items.map((item) => {
		const entry = (item ?? {}) as Record<string, unknown>;
		if (entry.about === "experience")
			return { ...entry, companyTag: inVocab("companyTag", entry.companyTag) };
		const field = entry.field;
		if (
			entry.about === "person" &&
			(VOCAB_KEYS as readonly unknown[]).includes(field)
		)
			return { ...entry, values: inVocab(field as VocabKey, entry.values) };
		return entry;
	});
	return sanitizeSpec({ conditions });
}

/**
 * 模型给出了条件，收窄之后一个不剩。
 *
 * 丢掉**单个**取值是设计内的：一个词表外的档、一个太长的词，丢掉比放行强。
 * 但**全丢**说明模型整体没按约定作答，而这一层没有别的办法把话读成条件。
 * 让查询带着一份空条件走下去，界面会画成「一个条件都没解析出来」，也就是
 * 把一次故障画成了「你没说条件」。所以调用方据此显式失败、可重试。
 */
export function allDropped(raw: unknown, spec: SearchSpec): boolean {
	const value = (raw ?? {}) as Record<string, unknown>;
	const asked = Array.isArray(value.conditions) ? value.conditions.length : 0;
	return asked > 0 && spec.conditions.length === 0;
}
