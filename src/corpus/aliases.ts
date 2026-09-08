/**
 * 能力词的对照表：别名 → 标准词，由整理任务定期整理。
 *
 * 抽出来的能力词是开放词表，同一项能力有好几种写法（「推荐算法」「个性化推荐」
 * 「Recommendation」）。检索不在乎——它们在向量空间里本来就是邻居；在乎的是筛选栏
 * 「入职前能力」那一栏（`src/search/dimensions.ts`）：它按词数人，写法不合并就是一串
 * 各有一两个人的项，没法点。
 *
 * 整理是一个后台任务（`review`，由 `src/server/jobs.ts` 定期跑）：读库里此刻
 * 能力词那一路上的词和各自的人数，按向量圈成组，每组问一次模型哪些只是同一项
 * 能力的不同写法，合并的结果写回对照表（`skill_alias`，`src/db/schema.ts`），
 * 并把指向别名的边改指标准词。派生任务写新段的边时按对照表换词（`apply`），
 * 所以库里能力词那一路永远只有标准词。全程无人；对照表记的是关于词的决定，
 * 换数据源、换嵌入空间都不清它。
 *
 * **向量圈组，模型下结论。** 相似度阈值只决定圈子多大，圈进了不相干的词由模型拆开
 * （「推荐系统」和「搜索推荐」是邻居，不是同一项能力）；模型每次只看一组几个词，不是
 * 整份词表。标准词不由模型选：就是组心，这组里人最多的词——留给模型选的时候它会
 * 把通用词并进具体词（「搜索」→「搜索结果页」）。模型只回答组里哪些词该并进组心。
 * 并不并的判据是筛选栏的用法：招聘的人点标准词时想不想看到写了候选词的人——限定了
 * 行业或对象的具体种类要并（「销售团队管理」→「团队管理」），只是其中一个环节的不并
 * （「团队培训」）。这条线小模型划不动，所以这一步用 `REVIEW_MODEL`。
 *
 * **一个词一周只判一次。** 问过模型的组心记下时间，`REVIEW_INTERVAL` 之内不再做组心；
 * 陪它一起被看的候选词不记——它们只是参考，下一轮可能自己做组心。这样每轮只问新词
 * 和到期的词，每天那一轮不重问。
 *
 * **只整理有读者的组。** 筛选栏按人数排，两个单人词合成一个双人词没人会点；组心
 * 至少 `HEAD_MIN` 人的组才问模型。
 */

import "@tanstack/react-start/server-only";
import { z } from "zod";
import { complete, reviewModel } from "#/server/chat";
import { embed } from "./embed";
import { type Extraction, tag } from "./extract";
import type { Report } from "./report";
import type { CorpusClient } from "./session";

/** 组心问过模型之后多久才再做组心。 */
const REVIEW_INTERVAL_DAYS = 7;
/**
 * 两个能力词的向量相似度到这个数才圈进同一组。bge-m3 上同一项能力的不同写法
 * 多在 0.8 以上；再低会把「数据分析」和「数据仓库」这种相邻领域圈到一起——
 * 模型能拆，但每组的词一多它就开始漏。
 */
const SIMILARITY = 0.8;
/** 一组最多几个词。圈子再大就是阈值定低了，模型面对二十个词会成片地判成同一项。 */
const GROUP_MAX = 12;
/** 组心至少几个人才值得整理。 */
const HEAD_MIN = 3;

const SYSTEM = `你在整理人才库从简历里抽出来的能力词，整理的结果给筛选栏用：招聘的人点一个标准词，看到所有具备这项能力的人。第一行是标准词，后面每行是一个候选词，括号里是写了它的人数。逐个判断每个候选词该不该并进标准词。

该并的：写了候选词的人，招聘的人按标准词找人时也会想看到他。
- 同一件事的不同写法：同义词、中英文、缩写、语序颠倒、多了「工作」「能力」「统筹」这类字。「人员管理」「员工管理」「小组管理」都并进「团队管理」。
- 标准词的一个具体种类，只是限定了行业、对象或产品：「销售团队管理」并进「团队管理」，「产品数据分析」并进「数据分析」，「品牌战略」并进「品牌策略」。

不该并的：
- 只是标准词里的某一个环节或活动，做过它不等于具备整项能力：「团队培训」「团队建设」「团队 SOP 管理」不并进「团队管理」；「数据统计」「数据处理」「数据分析报告」不并进「数据分析」。
- 相邻的另一件事，招聘时是另一个要求：「营销策略」「销售策略」不并进「运营策略」；「品牌营销」「广告策略」不并进「品牌策略」。
- 比标准词更宽的词：「增长」不并进「用户增长」，「管理」不并进「团队管理」。

每个候选词先用一句话说它属于上面哪一种，再下结论。输出 JSON：
{"judgments": [{"word": "候选词", "why": "一句话", "alias": true 或 false}]}
候选词原样照抄，每个候选词都要有一条。`;

/**
 * 逐词给理由再下结论，不是直接列名单：让模型一次列名单，它面对十来个相近的候选
 * 会整片说是或整片说否；逐词说完理由再判，每个词各判各的。理由只为约束判断，
 * 收窄时不读。
 */
const SCHEMA = z.object({
	judgments: z.array(
		z.object({ word: z.string(), why: z.string(), alias: z.boolean() }),
	),
});

/** 一个词的决定：它的标准词（等于自己就是标准词）和上次整理的时间。 */
export type Decision = { canonical: string; reviewedAt: Date };
export type Table = Map<string, Decision>;

export async function read(client: CorpusClient): Promise<Table> {
	const { rows } = await client.query<{
		word: string;
		canonical: string;
		reviewed_at: Date;
	}>("select word, canonical, reviewed_at from skill_alias");
	const table: Table = new Map(
		rows.map((row) => [
			row.word,
			{ canonical: row.canonical, reviewedAt: row.reviewed_at },
		]),
	);
	// 别名的标准词自己又是别名：`merge` 不会写出这种行，出现就是表被手改坏了，
	// 出声拒绝——静默取其一只会让筛选栏少一批人而没人知道
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
			`skill_alias 表里 ${chained.join("、")} 的标准词自己又是别名，表被改坏了`,
		);
	return table;
}

/**
 * 把这些决定写回表。
 *
 * 收的是**决定本身**，不是一串词名再回表里查：查得到查不到就得有个说法，而
 * 「查不到时写个空标准词」是一行悄悄坏掉的对照表。`merge` 手里本来就有决定。
 */
async function write(client: CorpusClient, decisions: [string, Decision][]) {
	if (decisions.length === 0) return;
	await client.query(
		`insert into skill_alias (word, canonical, reviewed_at)
		 select * from unnest($1::text[], $2::text[], $3::timestamptz[])
		 on conflict (word) do update
		 set canonical = excluded.canonical, reviewed_at = excluded.reviewed_at`,
		[
			decisions.map(([word]) => word),
			decisions.map(([, decision]) => decision.canonical),
			decisions.map(([, decision]) => decision.reviewedAt),
		],
	);
}

/** 别名 → 标准词，只含真正要换的词。 */
export function mapping(table: Table): Map<string, string> {
	const out = new Map<string, string>();
	for (const [word, decision] of table)
		if (decision.canonical !== word) out.set(word, decision.canonical);
	return out;
}

/** 把一段的能力词换成标准词，换完重复的只留一个。做过的事的领域不动。 */
export function apply(
	aliases: Map<string, string>,
	extraction: Extraction,
): Extraction {
	const skills: string[] = [];
	for (const skill of extraction.skills) {
		const canonical = aliases.get(skill) ?? skill;
		if (!skills.includes(canonical)) skills.push(canonical);
	}
	return { skills, did: extraction.did };
}

/**
 * 把相似的词圈成组，每组第一个词是组心，后面至少一个候选。
 *
 * 人最多的词先做组心，把还没分组、和它相似度够的词收进来。组和组不串：
 * 「数据分析 - 数据监控 - 监控告警」这种一环扣一环的链不会连成一大组。
 * 只有 `due` 里的词做组心；人不够 `HEAD_MIN` 的词也不做组心，只能被收进别人的组。
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

/** 把模型的原话收窄成组心的别名：只认组里的候选词里判成 true 的，其余当模型没说。 */
export function conform(raw: unknown, group: string[]): string[] {
	if (typeof raw !== "object" || raw === null) return [];
	const judgments = (raw as { judgments?: unknown }).judgments;
	const candidates = new Set(group.slice(1));
	const out: string[] = [];
	for (const item of Array.isArray(judgments) ? judgments : []) {
		if (typeof item !== "object" || item === null) continue;
		const judgment = item as { word?: unknown; alias?: unknown };
		if (judgment.alias !== true) continue;
		const word = tag(judgment.word);
		if (candidates.has(word) && !out.includes(word)) out.push(word);
	}
	return out;
}

/**
 * 记下这一组的结论，返回决定变了的词。
 *
 * 组心问过就记时间；并进来的词对到组心，此前对到它们的词也一起改指组心，
 * 表里于是不会出现「别名的别名」。
 */
export function merge(
	table: Table,
	head: string,
	aliases: string[],
	now: Date,
): [string, Decision][] {
	const changed = new Map<string, Decision>();
	const decide = (word: string) => {
		const decision: Decision = { canonical: head, reviewedAt: now };
		table.set(word, decision);
		changed.set(word, decision);
	};
	decide(head);
	for (const alias of aliases) {
		for (const [word, decision] of table)
			if (decision.canonical === alias) decide(word);
		decide(alias);
	}
	return [...changed];
}

function promptInput(group: string[], count: Map<string, number>): string {
	const [head, ...candidates] = group;
	return [
		`标准词：${head}`,
		...candidates.map((word) => `${word}（${count.get(word) ?? 0} 人）`),
	].join("\n");
}

/** 库里此刻能力词那一路上的词和各自的人数，按词排序。 */
async function vocabulary(client: CorpusClient) {
	const { rows } = await client.query<{ word: string; people: string }>(
		`select p.text as word, count(distinct e.emp_id) as people
		 from experience_phrase ep
		 join phrase p on p.id = ep.phrase_id
		 join experience e on e.id = ep.experience_id
		 where ep.route = 'skill'
		 group by p.text
		 order by p.text`,
	);
	return {
		words: rows.map((row) => row.word),
		counts: rows.map((row) => Number(row.people)),
	};
}

/**
 * 把指向这些别名的边改指各自的标准词。
 *
 * 标准词一定已经是一条说法：它是组心，组心来自这一轮的词表，词表来自边。同一段
 * 既写了别名又写了标准词的，改指之后两条边撞成一条，撞的那条丢掉即可。
 */
async function repoint(client: CorpusClient, moves: [string, string][]) {
	if (moves.length === 0) return;
	const words = moves.map(([word]) => word);
	const canonicals = moves.map(([, canonical]) => canonical);
	await client.query(
		`insert into experience_phrase (experience_id, route, phrase_id, involvement)
		 select ep.experience_id, 'skill', c.id, null
		 from experience_phrase ep
		 join phrase w on w.id = ep.phrase_id
		 join unnest($1::text[], $2::text[]) as m(word, canonical) on m.word = w.text
		 join phrase c on c.text = m.canonical
		 where ep.route = 'skill'
		 on conflict do nothing`,
		[words, canonicals],
	);
	await client.query(
		`delete from experience_phrase ep
		 using phrase w
		 where ep.route = 'skill' and w.id = ep.phrase_id and w.text = any($1::text[])`,
		[words],
	);
}

/** 整理一轮：到期的词圈组问模型，决定写回表，边改指标准词。过程报出来。 */
export async function review(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const now = new Date();
	const table = await read(client);
	const { words, counts } = await vocabulary(client);
	report(
		`  能力词 ${words.length} 个，对照表已有 ${table.size} 个词的决定；整理模型 ${reviewModel()}`,
	);
	if (words.length === 0) return;

	const overdue = now.getTime() - REVIEW_INTERVAL_DAYS * 86_400_000;
	const due = new Set(
		words.filter((word) => {
			const decision = table.get(word);
			return !decision || decision.reviewedAt.getTime() <= overdue;
		}),
	);
	const circles = groups(words, counts, await embed(words, report), due);
	report(
		`  组心至少 ${HEAD_MIN} 人、相似度 ${SIMILARITY} 以上、` +
			`${REVIEW_INTERVAL_DAYS} 天内没整理过，圈成 ${circles.length} 组`,
	);

	const count = new Map(words.map((word, index) => [word, counts[index] ?? 0]));
	const inputs = circles.map((group) => promptInput(group, count));
	const payloads = await complete(
		reviewModel(),
		SYSTEM,
		SCHEMA,
		inputs,
		"整理",
		report,
	);

	const changed = new Map<string, Decision>();
	const merged: [string, string][] = [];
	for (const [index, group] of circles.entries()) {
		const text = inputs[index] as string;
		if (!payloads.has(text)) continue;
		const aliases = conform(payloads.get(text), group);
		const head = group[0] as string;
		for (const [word, decision] of merge(table, head, aliases, now))
			changed.set(word, decision);
		merged.push(...aliases.map((alias): [string, string] => [alias, head]));
	}
	/*
	 * 决定和边在同一笔事务里：写了决定没改边，筛选栏里别名和标准词就各数各的人，
	 * 而派生按新表写的新段又只有标准词——同一个词两种答案。
	 */
	await client.query("begin");
	try {
		await write(client, [...changed]);
		await repoint(
			client,
			[...changed]
				.filter(([word, decision]) => decision.canonical !== word)
				.map(([word, decision]): [string, string] => [
					word,
					decision.canonical,
				]),
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
	report(
		merged.length ? `  合并 ${merged.length} 个写法：` : "  没有要合并的写法",
	);
	for (const [alias, canonical] of merged)
		report(`    ${alias} → ${canonical}`);
}
