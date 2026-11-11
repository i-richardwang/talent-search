/**
 * 查询理解的领域校验：模型提交的一份查询 → 这一轮的条件和说明。形状由 `query.ts` 的
 * `draftsOf` 校验，`where` 合不合白名单、能不能跑在提交工具里试跑时查（`server/agent-tools.ts`）。
 */
import { z } from "zod";
import { MODES } from "./condition";
import type { VocabKey } from "./dimensions";
import {
	contentKey,
	type DraftCondition,
	draftsOf,
	newConditionId,
	type Query,
	type QueryCondition,
	withOff,
} from "./query";
import { boundedText } from "./text";
import type { Matched } from "./trace";

/**
 * 有限取值的几维在人才库里的取值和人数，预先写进提示词。哪几维见 `VOCAB_KEYS`。
 */
export type Vocabulary = { [K in VocabKey]: readonly Matched[] };

const conditionItem = z.object({
	id: z.string().optional().meta({
		description: "沿用当前表里的一条时照抄它的 id，改了内容也照抄；新写的不写",
	}),
	label: z.string().meta({
		description: "写给 HR 看的一句话：这条在找什么样的人或经历",
	}),
	mode: z.enum(MODES).meta({
		description:
			"must=必须；boost=最好有；exclude=这个人不能有这样的经历，只用于 experience",
	}),
	from: z.enum(["experience", "person"]).meta({
		description:
			"experience=一段工作经历 e（写了 seek 时还有命中 h）；person=人 p",
	}),
	seek: z
		.object({
			criterion: z.string().meta({
				description:
					"两三句话：什么样的经历算要找的，什么不算。之后你照它从候选人的经历里挑出符合的",
			}),
			patterns: z.array(z.string()).meta({
				description:
					"正则，不分大小写，在人才库全部说法上按字面把候选捞出来，任一条匹配就捞到；这件事按字面找不出来时给空数组，where 圈出的每一段都是候选",
			}),
		})
		.optional()
		.meta({ description: "只用于 experience：这段经历做过什么" }),
	where: z.string().meta({
		description: "SQL 布尔表达式；不限就写 true",
	}),
	params: z
		.record(z.string(), z.union([z.string(), z.number()]))
		.optional()
		.meta({ description: "where 里 :name 的取值" }),
	minMonths: z.int().optional().meta({
		description: "只用于 experience 的必须与加分：满足这条的段累计至少多少个月",
	}),
});

/** 提交工具的回答形状。数量与长度上限在 `query.ts` 校验。 */
export const submissionSchema = z.object({
	conditions: z.array(conditionItem).meta({
		description:
			"整份新的条件。一条之内说的是同一段经历（同一个 e），条件之间说的是同一个人",
	}),
	note: z
		.object({
			says: z
				.string()
				.meta({ description: "对 HR 说的一句话，或者问的一个问题" }),
			current: z.string().nullable().meta({
				description:
					"问了问题时，现在这份条件是按哪种理解找的，写成 HR 会回的话；没有问题写 null",
			}),
			options: z
				.array(
					z.object({
						label: z.string().meta({
							description: "HR 可以选的另一种回答，写成 HR 会说的一句完整的话",
						}),
						detail: z
							.string()
							.meta({ description: "一句说明，人数来自查到的结果" }),
					}),
				)
				.meta({ description: "HR 可以选的别的回答；没有就空着" }),
		})
		.nullable()
		.meta({
			description: "名单上看不出、要 HR 知道或拿主意的一件事；没有就写 null",
		}),
});

/** 模型提交的一份查询：符合 schema，还没经过 `understood` 校验。 */
export type Submission = z.infer<typeof submissionSchema>;

/** HR 可以选的另一种回答：选它就是把这句话说给 AI，接着这一轮往下找。 */
type Choice = { label: string; detail?: string };

/**
 * 一次理解给 HR 的一句话，只属于写出它的那条记录。名单已经按条件出来了，这句话只说名单上
 * 看不出的：哪些要求人才库里没有，一个词有几种理解、现在按的是哪种。问的是一个问题时带上
 * 可选的回答，`current` 是现在这份条件按的那一种。没有要说的时候不写入（`null`）。
 */
export type TurnNotes = {
	says: string;
	choices: { current: string; others: Choice[] } | null;
};

/** 除了现在这一种，最多再给几种回答。再多 HR 就得读完一屏才能选。 */
const OTHERS_MAX = 3;

export type Understood = { query: Query; notes: TurnNotes | null };

/**
 * 定下每条的 id：沿用的照抄的 id 只认 `known` 里有的；没写 id、但内容和已知的某一条
 * 一样的，用那一条的 id；别的发新 id。同一个 id 一份查询里只用一次。
 */
function resolveIds(
	drafts: readonly DraftCondition[],
	known: readonly QueryCondition[],
): QueryCondition[] {
	const byId = new Map(known.map((c) => [c.id, c]));
	const byContent = new Map<string, QueryCondition>();
	for (const c of known)
		if (!byContent.has(contentKey(c))) byContent.set(contentKey(c), c);
	const used = new Set<string>();
	return drafts.map((d) => {
		let id = d.id && byId.has(d.id) && !used.has(d.id) ? d.id : undefined;
		if (!id) {
			const same = byContent.get(contentKey(d));
			if (same && !used.has(same.id)) id = same.id;
		}
		id ??= newConditionId();
		used.add(id);
		return { ...d, id };
	});
}

/**
 * 模型输出 → 这一轮的查询与说明。形状不合规的条件局部丢弃，不牵连整份；`admit` 不收的
 * 条件（提交检查里跑不通的，见 `server/agent-tools.ts`）按同一条规则丢弃。
 *
 * 停用状态跟着条件走：模型写不出停用，提交的条件和上一轮同一个 id、内容也没变时，那一条的
 * 停用原样带过来；用户停掉的不会因为又说了一句话就复活。
 */
export function understood(
	raw: unknown,
	base: readonly QueryCondition[],
	admit: (draft: DraftCondition) => boolean = () => true,
): Understood {
	const value = (raw ?? {}) as Record<string, unknown>;
	const prior = new Map(base.map((c) => [c.id, c]));
	const conditions = resolveIds(
		draftsOf(value.conditions)
			.filter(admit)
			.map((d) => withOff(d, null)),
		base,
	).map((c) => {
		const before = prior.get(c.id);
		return before?.off && contentKey(before) === contentKey(c)
			? withOff(c, before.off)
			: c;
	});
	return { query: { conditions }, notes: notesOf(value.note) };
}

/**
 * 模型写的说明 → 写入的说明。没写话的回答、重复的回答不用；没写现在按的是哪种理解时整组
 * 回答不用：HR 分不清不选会怎样。
 */
function notesOf(raw: unknown): TurnNotes | null {
	const note = (raw ?? {}) as Record<string, unknown>;
	const says = boundedText(note.says);
	if (!says) return null;
	const current = boundedText(note.current);
	const seen = new Set(current ? [current] : []);
	const others: Choice[] = [];
	for (const item of Array.isArray(note.options) ? note.options : []) {
		const entry = (item ?? {}) as Record<string, unknown>;
		const label = boundedText(entry.label);
		if (!label || seen.has(label)) continue;
		seen.add(label);
		const detail = boundedText(entry.detail);
		others.push({ label, ...(detail && { detail }) });
		if (others.length === OTHERS_MAX) break;
	}
	return {
		says,
		choices: current && others.length > 0 ? { current, others } : null,
	};
}

/**
 * 这次理解算不算作答了。不算的返回原因，调用方据此显式失败、可重试。
 *
 * - 模型给了条件，校验后**一条不剩**：它整体没按约定作答。让查询带着一份空条件走下去，
 *   界面会画成「这句话里没有能找人的条件」，也就是把一次故障画成了用户的问题。
 * - 条件空着，说明也空着：一句话要么能写成条件，要么说得出为什么写不了。
 */
export function unanswered(raw: unknown, result: Understood): string | null {
	const value = (raw ?? {}) as Record<string, unknown>;
	const asked = Array.isArray(value.conditions) ? value.conditions.length : 0;
	if (result.query.conditions.length > 0) return null;
	if (asked > 0)
		return `查询理解给出的条件全部不合规，校验后一个不剩：${JSON.stringify(
			value.conditions,
		).slice(0, 400)}`;
	if (!result.notes) return "查询理解既没有给出条件，也没有说明为什么";
	return null;
}
