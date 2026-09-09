/**
 * 自然语言理解的可信边界。模型把一句话拆成**片段**，这里把不可信的片段清单
 * 折成一份 SearchSpec；不包含网络调用。
 *
 * **为什么是片段清单，不是一张表。** 上一版让模型填一张八栏的表（职级、学历、
 * 公司档……每栏必填、null 表示没说），并把词表列在它眼前。表格邀请填满：
 * 一句只提了「字节」的话回来时八栏全有值，「字节」同时进了公司、学校和一条
 * 要求，而收窄层逐栏看每个值都合法，一处都拦不住——它从来没问过「这一栏是从
 * 句子里哪几个字来的」。片段清单把这件事变成形状：每个片段带 `said`，代码
 * 能查它是不是句子的子串、有没有被认领两次、取值在不在词表里。说不出口的错，
 * 模型就说不出来（要求那一侧的 `said` 早就是这么做的，见 `requirement.ts`）。
 *
 * **为什么 `said` 要模型来写、不由代码切。** 代码切不出「算法和后端都做过的」
 * 里哪几个字是条件、切成几条——那正是这次理解的全部判断。`said` 不是让模型
 * 重复一遍句子，是让它交出切分的结果，而且是**最便宜就能核对**的一种交法：
 * 逐字照抄，代码做一次子串检查。让它交字符偏移量的话，模型数不准，错一位
 * 整段都对不上。
 */
import { z } from "zod";
import {
	DIMENSIONS,
	type Picked,
	VOCAB_KEYS,
	type VocabKey,
} from "./dimensions";
import {
	boundedText,
	REQUIREMENT_MODES,
	type RequirementMode,
	requirementsOf,
	SAID_MAX,
	VARIANT_TIERS,
} from "./requirement";
import type { SearchNotice, SearchScope, SearchSpec } from "./spec";

/** 模型选择结构化值时只能看语料真实拥有的词表。哪几维有词表见 `VOCAB_KEYS`。 */
export type Vocabulary = { [K in VocabKey]: readonly string[] };

/**
 * 一个片段能是什么。要求、几维范围、没处放的条件，就这些；一个片段只能是其中
 * 之一——它就是上一版那句「每个片段只能去三个地方之一」，只是从劝说变成了枚举。
 */
const ITEM_KINDS = [
	"requirement",
	"org",
	"school",
	...VOCAB_KEYS,
	"kind",
	"minMonths",
	"unsupported",
] as const;
type ItemKind = (typeof ITEM_KINDS)[number];

/**
 * 发给模型的输出形状。**静态**：词表不进 schema，只在提示词里列一遍——同一份
 * 取值写两处就是两份契约；取值在不在词表里由 `toSpec` 查，查不过的片段变成
 * 「没处放的条件」，带着用户原话，而不是整条响应作废。
 *
 * 这里的描述只说每一栏**是什么**，不写字数、条数这些上限：上限住在收窄那一处
 * （`requirement.ts`），写进 schema 就是模型多给一个字整句失败。
 */
export const intentSchema = z.object({
	items: z
		.array(
			z.object({
				said: z.string().describe("这个片段在用户原话里的字，照抄，不改写"),
				is: z.enum(ITEM_KINDS).describe("这个片段是什么"),
				mode: z
					.enum(REQUIREMENT_MODES)
					.describe("must=必须；boost=最好有；exclude=不要"),
				value: z
					.string()
					.nullable()
					.describe(
						"范围维度的取值：level、education、recruitment、companyTag 从给定取值里挑一个，挑不出留空；kind 填 internal 或 external；minMonths 填月数。其余种类留空",
					),
				anyOf: z
					.array(z.string())
					.describe(
						"用户说「A 或 B」「A、B 均可」时，said 填 A，这里填 B 和其余几个。没有就空",
					),
				variants: z
					.array(
						z.object({
							text: z.string().describe("库里岗位会用的另一种叫法"),
							tier: z
								.enum(VARIANT_TIERS)
								.describe("same=同一件事的别名；near=更具体或相近的事"),
						}),
					)
					.describe("只有 requirement 才补。没有就空"),
			}),
		)
		.describe("句子里的片段，按出现顺序"),
});

export type Intent = z.infer<typeof intentSchema>;

/**
 * 一句话最多留几条「没处放的条件」。
 *
 * 它是载荷的闸，不是判断：这几条会原样存进不可变记录、随查询画在屏幕上。
 * 八条已经比一句话里说得出的条件多了。
 */
const UNSUPPORTED_MAX = 8;

/**
 * 「照抄」的核对口径：去掉所有空白、统一大小写之后做子串比较。
 *
 * 模型抄「BD」时可能写「bd」，抄「三年以上」时可能把中间的空格丢掉，这些都还是
 * 照抄；换成同义词、补一个句子里没有的字就不是。只做这两样归一，不做别的——
 * 多做一样就多一种「看起来照抄了其实没有」。
 */
function plain(text: string) {
	return text.replace(/\s+/g, "").toLowerCase();
}

type Draft = { members: unknown[]; mode: unknown };

/**
 * 模型输出 → 这句话的查询。任何不合规片段都被局部丢弃，不牵连整句。
 *
 * 三条只有片段清单才查得了的不变量，全在这里：
 *
 * 1. **said 必须是句子的子串。** 不是的片段丢掉：它说的是句子里没有的东西。
 * 2. **一段原话只能被认领一次。** 先出现的赢，后面的丢掉——「字节」既是公司
 *    又是学校时，第二次出现的那个不是理解，是复读。
 * 3. **范围取值必须在词表里。** 不在的不是丢掉，是降成「没处放的条件」，带着
 *    用户原话：「资深」对不上任何一档职级，屏幕上该写「资深：库里表达不了」，
 *    而不是安静消失。
 *
 * 范围片段的语气：must 收窄人群（`scope`），boost 只改名次（`prefer`），
 * exclude 没有对应的表示（「不要校招的」在这套维度里该说成「社招」），
 * 同样降成没处放的条件。
 */
export function toSpec(raw: unknown, sentence: string, vocab: Vocabulary) {
	const value = (raw ?? {}) as Record<string, unknown>;
	const items = Array.isArray(value.items) ? value.items : [];
	const haystack = plain(sentence);
	const claimed = new Set<string>();

	const drafts: Draft[] = [];
	const scope: SearchScope = {};
	const prefer: SearchScope = {};
	const unsupported: string[] = [];

	for (const item of items) {
		const entry = (item ?? {}) as Record<string, unknown>;
		const said = boundedText(entry.said);
		if (!said) continue;
		const key = plain(said);
		if (!key || !haystack.includes(key) || claimed.has(key)) continue;
		claimed.add(key);

		const is = ITEM_KINDS.includes(entry.is as ItemKind)
			? (entry.is as ItemKind)
			: "unsupported";
		const mode = REQUIREMENT_MODES.includes(entry.mode as RequirementMode)
			? (entry.mode as RequirementMode)
			: "must";

		if (is === "requirement") {
			// 「或」的另几个说法同样得是原话，而且同样只能被认领一次
			const anyOf = (Array.isArray(entry.anyOf) ? entry.anyOf : [])
				.map(boundedText)
				.filter((t): t is string => {
					if (!t) return false;
					const k = plain(t);
					if (!haystack.includes(k) || claimed.has(k)) return false;
					claimed.add(k);
					return true;
				})
				.slice(0, SAID_MAX - 1);
			// 变体的档只能是那两档：模型把一个变体标成 said，就是在认领原话
			const variants = (Array.isArray(entry.variants) ? entry.variants : [])
				.map((v) => (v ?? {}) as Record<string, unknown>)
				.filter((v) =>
					(VARIANT_TIERS as readonly string[]).includes(String(v.tier)),
				);
			drafts.push({
				members: [
					{ text: said, tier: "said" },
					...anyOf.map((text) => ({ text, tier: "said" })),
					...variants,
				],
				mode,
			});
			continue;
		}

		if (is === "unsupported" || mode === "exclude") {
			unsupported.push(said);
			continue;
		}

		const target = mode === "boost" ? prefer : scope;
		if (is === "org" || is === "school") {
			target[is] = said;
			continue;
		}

		const picked = pickDimension(is, entry.value, vocab);
		if (picked === undefined) {
			unsupported.push(said);
			continue;
		}
		Object.assign(target, picked);
	}

	const notices: SearchNotice[] = [...new Set(unsupported)]
		.slice(0, UNSUPPORTED_MAX)
		.map((text) => ({ kind: "unsupported" as const, text }));

	const spec: SearchSpec = {
		requirements: requirementsOf(drafts),
		scope,
		...(Object.keys(prefer).length > 0 && { prefer }),
		notices,
	};
	return spec;
}

/**
 * 一个范围片段的取值 → 这一维的一项。取值的清洗走维度自己的 `parse`，和 URL、
 * RPC 同一条口径；有词表的几维再多问一句在不在词表里。
 *
 * 模型一维只给一个值，落到记录上是这一维的一项（集合维裹成单元素列表）。
 */
function pickDimension(
	key: Exclude<ItemKind, "requirement" | "org" | "school" | "unsupported">,
	value: unknown,
	vocab: Vocabulary,
): Picked | undefined {
	const text = boundedText(value);
	if (!text) return undefined;
	if ((VOCAB_KEYS as readonly string[]).includes(key)) {
		const values = vocab[key as VocabKey];
		if (!values.includes(text)) return undefined;
		const parsed = DIMENSIONS[key as VocabKey].parse([text]);
		return parsed === undefined ? undefined : ({ [key]: parsed } as Picked);
	}
	const parsed = DIMENSIONS[key].parse(
		key === "minMonths" ? Number(text) : text,
	);
	return parsed === undefined ? undefined : ({ [key]: parsed } as Picked);
}

/**
 * 模型给出了片段，收窄之后一个不剩。
 *
 * 丢掉**单个**片段是设计内的：一个不是原话的词、一个不在词表里的取值，丢掉
 * 比放行强。但**全丢**说明模型整体没按约定作答，而这一层没有别的办法把话读成
 * 条件。让查询带着一份空条件走下去，界面会画成「一个条件都没解析出来」，也就是
 * 把一次故障画成了「你没说条件」。所以调用方据此显式失败、可重试。
 */
export function allDropped(raw: unknown, spec: SearchSpec): boolean {
	const value = (raw ?? {}) as Record<string, unknown>;
	const asked = Array.isArray(value.items) ? value.items.length : 0;
	return (
		asked > 0 &&
		spec.requirements.length === 0 &&
		Object.keys(spec.scope).length === 0 &&
		spec.prefer === undefined &&
		spec.notices.length === 0
	);
}
