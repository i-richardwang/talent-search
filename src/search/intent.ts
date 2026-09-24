/**
 * 自然语言理解的可信边界。模型拿着当前条件和用户这一次说的话，交回整张新的
 * 条件表和一份说明；这里把不可信的那份收窄成 `SearchSpec` 与 `TurnNotes`，
 * 不包含网络调用。
 *
 * **模型的任务是维护这条搜索，不是理解句子。** 它交出来的条件和用户在 chip 上
 * 改的、库里存的是同一个形状（为什么是这个形状，见 `condition.ts`），中间没有
 * 翻译：这里只做词表检查和沿用停用状态，其余收窄和 RPC 入参走同一道 `sanitizeSpec`。
 *
 * **名单只从检索来。** 模型写的是条件，谁在名单上、排第几由检索决定。
 */
import { z } from "zod";
import {
	type Condition,
	conditionKey,
	MODES,
	PERSON_FIELDS,
	PERSON_MODES,
	withOff,
} from "./condition";
import { VOCAB_KEYS, type VocabKey } from "./dimensions";
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
	values: z.array(z.string()).describe("任一即可；词表维从给出的取值里挑"),
});

export const conditionItems = z.array(
	z.discriminatedUnion("about", [experienceItem, personItem]),
);

/**
 * 发给模型的输出形状：整张新的条件表，加上这一轮的说明。**静态**：词表不进
 * schema，只在提示词里列一遍——同一份取值写两处就是两份契约；取值在不在词表里
 * 由 `understood` 查，查不过的取值丢掉，而不是整条响应作废。
 *
 * 交回整张表而不是一串增删改：表和 chip、库里存的是同一个形状，这一轮改了什么
 * 由两张表一比就知道，模型不必再学一套编辑指令。
 *
 * 每一项有自己的类型：月数是数字、经历来源是二选一、词表维各是一栏——模型看
 * schema 就知道填什么，不必读一段「这一维填什么样子」的说明。
 *
 * 这里的描述只说每一栏**是什么**，不写字数、条数这些上限：上限住在收窄那一处
 * （`condition.ts`），写进 schema 就是模型多给一个字整句失败。
 */
export const intentSchema = z.object({
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

/**
 * 模型给出的一条「搜不了」：原话、原因、可以换成的条件。
 * `instead` 已经过和条件表同一道收窄，界面上点一下就能加进查询。
 */
type Declined = { said: string; why: string; instead: Condition[] };

/**
 * 一次理解的说明，只属于写出它的那条记录。条件表是查询本身，说明是对这一轮的
 * 交代：替用户定了什么读法、哪些要求搜不了。两样都没有时不落库（`null`）。
 */
export type TurnNotes = { assumed: string[]; declined: Declined[] };

/** 说明里每一类最多几条。再多就不是交代，是一段需要人读完才能继续的正文。 */
const NOTES_MAX = 3;

/** 一次理解收窄之后的样子：新的条件表，和这一轮的说明。 */
type Understood = { spec: SearchSpec; notes: TurnNotes | null };

/**
 * 模型输出 → 这一轮的新查询与说明。不合规的取值局部丢弃，不牵连整句。
 *
 * 只多做两件 `conditionsOf` 做不了的事：
 *
 * 1. **词表维的取值必须在词表里。** 模型是唯一会写出词表外取值的来源（「资深」
 *    对不上任何一档职级），RPC 那一侧的取值来自屏幕上的候选。
 * 2. **停用状态跟着条件走。** 模型写不出停用（schema 里没有这一栏），交回来的
 *    条件和上一轮某一条完全相同时，那一条的停用原样带过来：用户停掉的不会因为
 *    又说了一句话就复活，量出来太宽的也不会。
 */
export function understood(
	raw: unknown,
	vocab: Vocabulary,
	base: readonly Condition[],
): Understood {
	const value = (raw ?? {}) as Record<string, unknown>;
	const narrow = (list: unknown) => conditionsIn(list, vocab);
	const offs = new Map(base.map((c) => [conditionKey(c), c.off ?? null]));
	const conditions = narrow(value.conditions).map((c) =>
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
		declined.push({ said, why, instead: narrow(entry.instead) });
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

/** 一列不可信的条件 → 收窄且词表维取值都在词表里的条件。 */
function conditionsIn(raw: unknown, vocab: Vocabulary): Condition[] {
	const items = Array.isArray(raw) ? raw : [];
	const inVocab = (key: VocabKey, list: unknown) =>
		(Array.isArray(list) ? list : [])
			.map(boundedText)
			.filter((t): t is string => t !== undefined && vocab[key].includes(t));
	const conditions = items.map((item) => {
		const entry = (item ?? {}) as Record<string, unknown>;
		// 停用只由上一轮带过来，模型那一侧写的一律不认
		const { off: _off, ...rest } = entry;
		if (rest.about === "experience")
			return { ...rest, companyTag: inVocab("companyTag", rest.companyTag) };
		const field = rest.field;
		if (
			rest.about === "person" &&
			(VOCAB_KEYS as readonly unknown[]).includes(field)
		)
			return { ...rest, values: inVocab(field as VocabKey, rest.values) };
		return rest;
	});
	return sanitizeSpec({ conditions }).conditions;
}

/**
 * 这次理解算不算作答了。不算的返回原因，调用方据此显式失败、可重试。
 *
 * 丢掉**单个**取值是设计内的：一个词表外的档、一个太长的词，丢掉比放行强。
 * 两种情况不是：
 *
 * - 模型给了条件，收窄后**一条不剩**：它整体没按约定作答。让查询带着一份空条件
 *   走下去，界面会画成「这句话里没有能找人的条件」，也就是把一次故障画成了用户
 *   的问题。
 * - 条件表空着，说明也空着：一句话要么能写成条件，要么说得出为什么写不了。
 *   什么都没交回来的是没作答，不是「成功但没有条件」。
 */
export function unanswered(raw: unknown, result: Understood): string | null {
	const value = (raw ?? {}) as Record<string, unknown>;
	const asked = Array.isArray(value.conditions) ? value.conditions.length : 0;
	if (result.spec.conditions.length > 0) return null;
	if (asked > 0)
		return `查询理解给出的条件全部不合规，收窄后一个不剩：${JSON.stringify(
			value.conditions,
		).slice(0, 400)}`;
	if (!result.notes) return "查询理解既没有给出条件，也没有说明为什么";
	return null;
}

/**
 * 模型正文里那一个 JSON 对象。用过工具之后模型爱先说一句「搜出 288 人，交回新表：」
 * 再给一段代码栏，而结构化输出只认整段正文是 JSON。有代码栏就取栏里的，没有就取
 * 第一个 `{` 到最后一个 `}`；什么都没有就原样交回去，让解析照常报错。
 */
export function jsonText(text: string): string {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
	const body = fenced?.[1] ?? text;
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	return start >= 0 && end > start ? body.slice(start, end + 1) : text;
}
