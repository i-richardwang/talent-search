/** 词表判定的校验、找参考词与生效。生产的生效一步和验收共用这些纯函数。 */
import { z } from "zod";
import type { Question } from "./judgment";
import { MAX_TAG_LEN, tag } from "./tag";

/** 模型回答与外部判定共用的形状；`kind` 取值和 `target` 的规则由 `conform` 校验。 */
export const PLACEMENT_SCHEMA = z.object({
	why: z.string(),
	kind: z.string(),
	target: z.string(),
});

/**
 * 一个要判的词带几个参考词。参考词只按向量取最接近的几个，不设相似度门槛：
 * 词表里没有相近写法的词也要判，判定方看过参考词之后可以说一个都对不上。
 */
const NEAR = 8;

/**
 * 一个词的决定：它的标准写法（等于自己就是标准词）、标准词属于哪个更宽的词
 * （别名上恒为 null）、判定方是不是认定它不是一项能力，和上次判它的时间；
 * 时间是 null 的词还没判过或被退回重判，下一轮整理会收集它。
 * 不是能力的词自成一行：没有别名，没有归属，也没有词指向它。
 */
export type Decision = {
	canonical: string;
	parent: string | null;
	excluded: boolean;
	reviewedAt: Date | null;
};
export type Table = Map<string, Decision>;

/** 判定方对一个词说了什么，校验之后的样子。 */
export type Verdict =
	| { kind: "same"; as: string }
	| { kind: "under"; parent: string }
	| { kind: "alone" }
	| { kind: "excluded" };

/** 一个词的上一级：别名走它标准词的归属。没有就是 null。 */
function ancestor(table: Table, word: string): string | null {
	const decision = table.get(word);
	if (!decision) return null;
	return decision.canonical === word
		? decision.parent
		: (table.get(decision.canonical)?.parent ?? null);
}

/** 拒绝别名链、归属于别名、归属环，以及带着关系的「不是能力」。 */
export function validate(table: Table): void {
	const broken = (
		what: string,
		bad: (word: string, decision: Decision) => boolean,
	) => {
		const words = [...table]
			.filter(([word, decision]) => bad(word, decision))
			.map(([word]) => word)
			.sort();
		if (words.length)
			throw new Error(`term 表里 ${words.join("、")} ${what}，表被改坏了`);
	};
	broken("的标准词自己又是别名", (word, decision) => {
		const target = table.get(decision.canonical);
		return (
			decision.canonical !== word &&
			target !== undefined &&
			target.canonical !== decision.canonical
		);
	});
	broken("归属于一个别名", (_, decision) => {
		const target = decision.parent ? table.get(decision.parent) : undefined;
		return target !== undefined && target.canonical !== decision.parent;
	});
	broken("对到或归属于一个不是能力的词", (word, decision) =>
		[decision.canonical, decision.parent].some(
			(target) =>
				target !== null && target !== word && table.get(target)?.excluded,
		),
	);
	for (const [word] of table) {
		const seen = new Set<string>();
		for (let at: string | null = word; at !== null; at = ancestor(table, at)) {
			if (seen.has(at))
				throw new Error(`term 表里 ${word} 的归属成环，表被改坏了`);
			seen.add(at);
		}
	}
}

/**
 * 在一批候选词里找参考词：给一个词和它的向量，返回候选里最接近的几个，近的在前，
 * 和它同一个写法的那个不算。候选只归一化一次，之后每问一个词是一趟点积。
 */
export function nearest(
	pool: string[],
	vectors: number[][],
): (word: string, vector: number[]) => string[] {
	const unit = (vector: number[]) => {
		const norm = Math.hypot(...vector) || 1;
		return Float32Array.from(vector, (value) => value / norm);
	};
	const candidates = vectors.map(unit);
	return (word, vector) => {
		const anchor = unit(vector);
		const best: { at: number; score: number }[] = [];
		for (let at = 0; at < candidates.length; at++) {
			if (pool[at] === word) continue;
			const score = similarity(anchor, candidates[at] as Float32Array);
			if (best.length === NEAR && score <= (best[NEAR - 1]?.score ?? 0))
				continue;
			const slot = best.findIndex((one) => score > one.score);
			best.splice(slot === -1 ? best.length : slot, 0, { at, score });
			if (best.length > NEAR) best.pop();
		}
		return best.map((one) => pool[one.at] as string);
	};
}

/**
 * 两个已经归一化的向量的余弦。四路分开累加：一路累加每一步都等上一步的结果，
 * 几万个词各扫一遍候选时要多花一倍多的时间。
 */
function similarity(a: Float32Array, b: Float32Array): number {
	const even = a.length - (a.length % 4);
	let s0 = 0;
	let s1 = 0;
	let s2 = 0;
	let s3 = 0;
	for (let i = 0; i < even; i += 4) {
		s0 += (a[i] as number) * (b[i] as number);
		s1 += (a[i + 1] as number) * (b[i + 1] as number);
		s2 += (a[i + 2] as number) * (b[i + 2] as number);
		s3 += (a[i + 3] as number) * (b[i + 3] as number);
	}
	for (let i = even; i < a.length; i++)
		s0 += (a[i] as number) * (b[i] as number);
	return s0 + s1 + s2 + s3;
}

/**
 * 校验判定方对一个词的原话；不成一条判断的返回 null，这个词仍是没判过的，下一轮再判。
 *
 * 「同一件事」必须指向它的一个参考词；「属于」可以指向参考词或由判定方起名，
 * 不超过 `MAX_TAG_LEN` 且不是自己。原样命中的参考词保留它的写法，否则清理全半角
 * 会让简历里的原词失去身份。宽细关系由判定方按 GUIDE 判断，不按字面包含推断。
 *
 * **自带模型和外部 agent 走的是这同一处。** 外部交上来的东西比模型的更不可信，
 * 不给它第二个入口；接口那一侧只把原话原样存下，不在写入时校验。
 */
export function conform(
	raw: unknown,
	word: string,
	near: string[],
): Verdict | null {
	const parsed = PLACEMENT_SCHEMA.safeParse(raw);
	if (!parsed.success) return null;
	const kind = tag(parsed.data.kind);
	const target = near.includes(parsed.data.target)
		? parsed.data.target
		: tag(parsed.data.target);
	if (kind === "自成一项") return { kind: "alone" };
	if (kind === "不是能力") return { kind: "excluded" };
	if (target === "" || target === word) return null;
	if (kind === "同一件事")
		return near.includes(target) ? { as: target, kind: "same" } : null;
	if (kind === "属于")
		return [...target].length <= MAX_TAG_LEN
			? { kind: "under", parent: target }
			: null;
	return null;
}

/**
 * 让一个词的判定生效，返回决定变了的词。只有被判的这个词记下这一次的时间。
 * 跟着它换了标准写法或归属的词保持原来的时间；判定方新起名的更宽的词、从一个
 * 不是能力的词上放开的词没有时间，下一轮各自判一次。
 *
 * - 同一件事：它和它名下的写法并进那个词所在的一项，属于它的词改属于这一项。两边人多的
 *   那个做标准写法；这一项的归属沿用被并进去的那一项的。
 * - 属于：它自己是一个标准词（原来是别名的就此拆出来），归属取那个词的标准写法；
 *   表里没有的词给它写一行，它从此是一个标准词。
 * - 自成一项：它自己是一个标准词，没有归属。
 * - 不是能力：它名下的写法和属于它的词各自放开，各自重判。
 *
 * 指向「不是能力」的词的判定不成立：同一件事的整条不记，归属丢掉。归属沿表往上会走回
 * 自己的也丢掉，表里于是不会成环，也不会出现别名的别名和归属于别名。
 */
export function place(
	table: Table,
	question: Question,
	verdict: Verdict,
	now: Date,
): [string, Decision][] {
	const word = question.word;
	const changed = new Map<string, Decision>();
	const released = new Set<string>();
	const decide = (
		one: string,
		canonical: string,
		parent: string | null,
		excluded = false,
	) => {
		const decision: Decision = {
			canonical,
			excluded,
			parent,
			reviewedAt:
				one === word
					? now
					: released.has(one)
						? null
						: (table.get(one)?.reviewedAt ?? null),
		};
		table.set(one, decision);
		changed.set(one, decision);
	};
	/** 把对到、归属于 `from` 的词改到 `to` 上；`to` 为 null 就各自放开。 */
	const move = (from: string, to: string | null) => {
		// 遍历的是快照：`decide` 往同一张表里写
		for (const [other, decision] of [...table]) {
			if (other === from || other === to) continue;
			if (decision.canonical !== from && decision.parent !== from) continue;
			if (to === null) released.add(other);
			if (decision.canonical === from) decide(other, to ?? other, null);
			else if (decision.parent === from) decide(other, other, to);
		}
	};
	/** 一项的归属：是这一项自己、沿表往上会走回这一项的都不要。 */
	const above = (head: string, parent: string | null) => {
		for (let at = parent; at !== null; at = ancestor(table, at))
			if (at === head) return null;
		return parent;
	};
	/** 判定方写的那个更宽的词落到表里的哪个标准词上。 */
	const standard = (named: string): string | null => {
		const decision = table.get(named);
		if (decision?.excluded) return null;
		return decision?.canonical ?? named;
	};

	if (verdict.kind === "excluded") {
		move(word, null);
		decide(word, word, null, true);
		return [...changed];
	}

	if (verdict.kind === "same") {
		const joined = standard(verdict.as);
		if (joined === null) return [];
		const before = table.get(word);
		if (joined === word || before?.canonical === joined) {
			decide(word, before?.canonical ?? word, before?.parent ?? null);
			return [...changed];
		}
		const rival = question.near.find((one) => one.word === joined)?.people;
		const head = rival !== undefined && question.people > rival ? word : joined;
		const other = head === word ? joined : word;
		const inherited = table.get(joined)?.parent ?? null;
		move(other, head);
		decide(other, head, null);
		decide(head, head, null);
		decide(head, head, above(head, inherited === other ? null : inherited));
		return [...changed];
	}

	const named = verdict.kind === "under" ? standard(verdict.parent) : null;
	decide(word, word, null);
	const parent = above(word, named);
	if (parent !== null && !table.has(parent)) decide(parent, parent, null);
	decide(word, word, parent);
	return [...changed];
}
