/**
 * 自然语言理解的可信边界。模型把一句话写成一份查询（`Term[]`），这里把
 * 不可信的那份收窄成 `SearchSpec`；不包含网络调用。
 *
 * **模型的任务是写这条搜索，不是理解句子。** 它交出来的对象和用户在 chip 上
 * 改的、库里存的是同一个形状（为什么是这个形状、为什么搜索词不必是用户原话，
 * 见 `term.ts`），中间没有翻译：这里只做词表检查，其余收窄和 RPC 入参走同一道
 * `sanitizeSpec`。
 */
import { z } from "zod";
import { VOCAB_KEYS, type VocabKey } from "./dimensions";
import { type SearchSpec, sanitizeSpec } from "./spec";
import { TERM_FIELDS, TERM_MODES } from "./term";
import { boundedText } from "./text";

/** 模型选择结构化值时只能看语料真实拥有的词表。哪几维有词表见 `VOCAB_KEYS`。 */
export type Vocabulary = { [K in VocabKey]: readonly string[] };

/**
 * 发给模型的输出形状：就是查询本身。**静态**：词表不进 schema，只在提示词里
 * 列一遍——同一份取值写两处就是两份契约；取值在不在词表里由 `toSpec` 查，
 * 查不过的取值丢掉，而不是整条响应作废。
 *
 * 这里的描述只说每一栏**是什么**，不写字数、条数这些上限：上限住在收窄那一处
 * （`term.ts`），写进 schema 就是模型多给一个字整句失败。
 */
export const intentSchema = z.object({
	terms: z
		.array(
			z.object({
				field: z
					.enum(TERM_FIELDS)
					.describe(
						"在哪一维找：experience 是做过什么；org、school 是公司或学校名；其余是范围维度",
					),
				mode: z
					.enum(TERM_MODES)
					.describe("must=必须；boost=最好有；exclude=不要（只对 experience）"),
				values: z
					.array(z.string())
					.describe("这一维上任一满足即可的几个取值，每维填什么见说明"),
			}),
		)
		.describe("查询条件，条件之间是「且」；同一维、同一强度只写一条"),
});

/**
 * 模型输出 → 这句话的查询。不合规的取值局部丢弃，不牵连整句。
 *
 * 只多做一件 `termsOf` 做不了的事：**范围取值必须在词表里**。模型是唯一会
 * 写出词表外取值的来源（「资深」对不上任何一档职级），RPC 那一侧的取值来自
 * 屏幕上的候选。对不上的取值丢掉，一个不剩的条件整条消失——搜索产品对
 * 说不清的条件就是不管，不解释。
 */
export function toSpec(raw: unknown, vocab: Vocabulary): SearchSpec {
	const value = (raw ?? {}) as Record<string, unknown>;
	const items = Array.isArray(value.terms) ? value.terms : [];
	const terms = items.map((item) => {
		const entry = (item ?? {}) as Record<string, unknown>;
		const field = typeof entry.field === "string" ? entry.field : "";
		if (!(VOCAB_KEYS as readonly string[]).includes(field)) return entry;
		const key = field as VocabKey;
		const values = (Array.isArray(entry.values) ? entry.values : [])
			.map(boundedText)
			.filter((t): t is string => t !== undefined && vocab[key].includes(t));
		return { ...entry, values };
	});
	return sanitizeSpec({ terms });
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
	const asked = Array.isArray(value.terms) ? value.terms.length : 0;
	return asked > 0 && spec.terms.length === 0;
}
