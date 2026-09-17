/** 能力词的收窄、圈组与词表归并。生产的生效一步和验收共用这些纯函数。 */
import type { Member } from "./judgment";
import { MAX_TAG_LEN, tag } from "./tag";

/**
 * 两个能力词的向量相似度到这个数才圈进同一组。bge-m3 上同一项能力的不同写法
 * 多在 0.8 以上；再低会把「数据分析」和「数据仓库」这种相邻领域圈到一起——
 * 判定方能拆，但每组的词一多它就开始漏。
 */
export const SIMILARITY = 0.8;
/** 一组最多几个词。圈子再大就是阈值定低了，判定方面对二十个词会成片地判成同一项。 */
const GROUP_MAX = 12;
/** 中心词至少几个人才值得整理。 */
export const HEAD_MIN = 3;

/**
 * 一个词的决定：它的标准写法（等于自己就是标准词）、标准词属于哪个更宽的词
 * （别名上恒为 null）、上次判它的时间，和判它的那一方。
 */
export type Decision = {
	canonical: string;
	parent: string | null;
	reviewedAt: Date;
	judge: string;
};
export type Table = Map<string, Decision>;

/** 一个词的上一级：别名走它标准词的归属。没有就是 null。 */
function ancestor(table: Table, word: string): string | null {
	const decision = table.get(word);
	if (!decision) return null;
	return decision.canonical === word
		? decision.parent
		: (table.get(decision.canonical)?.parent ?? null);
}

/** 拒绝别名链、归属于别名和归属环。 */
export function validate(table: Table): void {
	const chained = [...table]
		.filter(([word, decision]) => {
			const target = table.get(decision.canonical);
			return (
				decision.canonical !== word &&
				target !== undefined &&
				target.canonical !== decision.canonical
			);
		})
		.map(([word]) => word)
		.sort();
	if (chained.length)
		throw new Error(
			`skill_term 表里 ${chained.join("、")} 的标准词自己又是别名，表被改坏了`,
		);
	const bent = [...table]
		.filter(([, decision]) => {
			if (decision.parent === null) return false;
			const target = table.get(decision.parent);
			return target !== undefined && target.canonical !== decision.parent;
		})
		.map(([word]) => word)
		.sort();
	if (bent.length)
		throw new Error(
			`skill_term 表里 ${bent.join("、")} 归属于一个别名，表被改坏了`,
		);
	for (const [word] of table) {
		const seen = new Set<string>();
		for (let at: string | null = word; at !== null; at = ancestor(table, at)) {
			if (seen.has(at))
				throw new Error(`skill_term 表里 ${word} 的归属成环，表被改坏了`);
			seen.add(at);
		}
	}
}

/**
 * 把相似的词圈成组，每组第一个词是中心词，后面至少一个候选。
 *
 * 人最多的词先做中心词，把还没分组、和它相似度够的词收进来。组和组不重叠：
 * 「数据分析 - 数据监控 - 监控告警」这种一环扣一环的链不会连成一大组。
 * 只有 `due` 里的词做中心词；人不够 `HEAD_MIN` 的词也不做中心词，只能被收进别人的组。
 */
export function groups(
	words: string[],
	counts: number[],
	vectors: number[][],
	due: Set<string>,
): string[][] {
	const units = vectors.map((vector) => {
		const norm = Math.hypot(...vector) || 1;
		return Float32Array.from(vector, (value) => value / norm);
	});
	const order = [...words.keys()].sort(
		(a, b) =>
			(counts[b] ?? 0) - (counts[a] ?? 0) ||
			(words[a] as string).localeCompare(words[b] as string),
	);
	const free = new Array(words.length).fill(true);
	const out: string[][] = [];
	for (const head of order) {
		if ((counts[head] ?? 0) < HEAD_MIN) break;
		if (!free[head] || !due.has(words[head] as string)) continue;
		free[head] = false;
		const anchor = units[head] as Float32Array;
		const members: number[] = [];
		for (const candidate of order) {
			if (members.length === GROUP_MAX - 1) break;
			if (!free[candidate]) continue;
			if (similarity(anchor, units[candidate] as Float32Array) >= SIMILARITY)
				members.push(candidate);
		}
		if (members.length) {
			for (const member of members) free[member] = false;
			out.push([
				words[head] as string,
				...members.map((index) => words[index] as string),
			]);
		}
	}
	return out;
}

/** 两个已经归一化的向量的余弦。 */
function similarity(a: Float32Array, b: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += (a[i] as number) * (b[i] as number);
	return sum;
}

/** 判定方对一个词说了什么，收窄之后的样子。 */
type Verdict = { sameAs: string | null; parent: string | null };

/**
 * 把判定方的原话收窄成逐词的判断：只认这一组里的词，一个词只认第一条。
 *
 * `sameAs` 必须是这一组里的另一个词；`parent` 是判定方起的名字，只要求它是一条能力词
 * （规范写法、不超过 `MAX_TAG_LEN`），不是这个词自己，也不含着这个词——含着它的词
 * 比它更具体，方向反了的归属（「数据分析」属于「销售数据分析」）在这里就拦下。
 *
 * **自带模型和外部 agent 走的是这同一处。** 外部交上来的东西比模型的更不可信，
 * 不给它第二个入口；接口那一侧只把原话原样存进组里，不在写入时收窄。
 */
export function conform(raw: unknown, words: string[]): Map<string, Verdict> {
	const out = new Map<string, Verdict>();
	if (typeof raw !== "object" || raw === null) return out;
	const judgments = (raw as { judgments?: unknown }).judgments;
	const allowed = new Set(words);
	for (const item of Array.isArray(judgments) ? judgments : []) {
		if (typeof item !== "object" || item === null) continue;
		const judgment = item as {
			word?: unknown;
			sameAs?: unknown;
			parent?: unknown;
		};
		const word = tag(judgment.word);
		if (!allowed.has(word) || out.has(word)) continue;
		const sameAs = tag(judgment.sameAs);
		const parent = tag(judgment.parent);
		const broader =
			parent !== "" &&
			[...parent].length <= MAX_TAG_LEN &&
			parent !== word &&
			!parent.includes(word);
		out.set(word, {
			parent: broader ? parent : null,
			sameAs: allowed.has(sameAs) && sameAs !== word ? sameAs : null,
		});
	}
	return out;
}

/**
 * 记下一组的结论，返回决定变了的词。
 *
 * `sameAs` 连成的每一片是同一件事，片里人最多的词做标准写法；片里的其他词对到它。
 * 表里此前对到它们、归属于它们、又不在这一组里的词也一起跟过去，表里于是不会出现
 * 「别名的别名」和「归属于别名」；这一次被判过的词各有自己的判断，不跟。片的归属由片里的判断按人数投出来；它若是这一组里另一片的词就取那一片的
 * 标准写法，若是表里的别名就取它的标准词；沿表往上走会走回自己的归属丢掉，表里于是
 * 不会成环。归属是表里没有的词时给它落一行——它从此是一个标准词。
 *
 * 判过的每个词都记时间：判定方看过它，一周内不必再看。
 */
export function merge(
	table: Table,
	members: Member[],
	verdicts: Map<string, Verdict>,
	now: Date,
	judge: string,
): [string, Decision][] {
	const people = new Map(members.map((one) => [one.word, one.people]));
	const classes = sameClasses(
		[...verdicts].map(([word, verdict]) => [word, verdict.sameAs]),
	);
	const headOf = new Map<string, string>();
	for (const cluster of classes) {
		const head = cluster
			.slice()
			.sort(
				(a, b) =>
					(people.get(b) ?? 0) - (people.get(a) ?? 0) || a.localeCompare(b),
			)[0] as string;
		for (const word of cluster) headOf.set(word, head);
	}

	const changed = new Map<string, Decision>();
	const decide = (word: string, canonical: string, parent: string | null) => {
		const decision: Decision = { canonical, judge, parent, reviewedAt: now };
		table.set(word, decision);
		changed.set(word, decision);
	};

	for (const cluster of classes) {
		const head = headOf.get(cluster[0] as string) as string;
		const parent = electParent(table, cluster, head, headOf, verdicts, people);
		if (parent !== null && !table.has(parent)) decide(parent, parent, null);
		for (const word of cluster) {
			if (word === head) continue;
			// 遍历的是快照：`decide` 往同一张表里写，边遍历边写会把刚写的行再走一遍
			for (const [other, decision] of [...table]) {
				if (verdicts.has(other)) continue;
				if (decision.canonical === word) decide(other, head, null);
				else if (decision.parent === word) decide(other, other, head);
			}
			decide(word, head, null);
		}
		decide(head, head, parent);
	}
	return [...changed];
}

/** `sameAs` 连成的片：无向、传递，孤立的词自成一片。 */
function sameClasses(links: [string, string | null][]): string[][] {
	const parentOf = new Map<string, string>();
	const find = (word: string): string => {
		let at = word;
		while (parentOf.get(at) !== undefined && parentOf.get(at) !== at)
			at = parentOf.get(at) as string;
		return at;
	};
	for (const [word, sameAs] of links) {
		parentOf.set(word, find(word));
		if (sameAs === null) continue;
		if (!parentOf.has(sameAs)) parentOf.set(sameAs, sameAs);
		const a = find(word);
		const b = find(sameAs);
		if (a !== b) parentOf.set(a, b);
	}
	const byRoot = new Map<string, string[]>();
	for (const word of parentOf.keys()) {
		const root = find(word);
		byRoot.set(root, [...(byRoot.get(root) ?? []), word]);
	}
	return [...byRoot.values()];
}

/** 一片的归属：片里的判断按人数投票，再按表和这一组的其他片解析成一个标准词。 */
function electParent(
	table: Table,
	cluster: string[],
	head: string,
	headOf: Map<string, string>,
	verdicts: Map<string, Verdict>,
	people: Map<string, number>,
): string | null {
	const votes = new Map<string, number>();
	for (const word of cluster) {
		const named = verdicts.get(word)?.parent;
		if (!named) continue;
		votes.set(named, (votes.get(named) ?? 0) + (people.get(word) ?? 0));
	}
	const elected = [...votes].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
	)[0]?.[0];
	if (elected === undefined) return null;
	const resolved =
		headOf.get(elected) ??
		(table.get(elected)?.canonical !== undefined
			? (table.get(elected) as Decision).canonical
			: elected);
	if (cluster.includes(resolved)) return null;
	for (let at: string | null = resolved; at !== null; at = ancestor(table, at))
		if (at === head || cluster.includes(at)) return null;
	return resolved;
}
