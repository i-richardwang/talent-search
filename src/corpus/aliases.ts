/**
 * 能力词的对照表：别名 → 标准词，由整理任务定期整理。
 *
 * 抽出来的能力词是开放词表，同一项能力有好几种写法（「推荐算法」「个性化推荐」
 * 「Recommendation」）。检索不在乎——它们在向量空间里本来就是邻居；在乎的是筛选栏
 * 「入职前技能」那一栏（`src/search/dimensions.ts`）：它按词数人，写法不合并就是一串
 * 各有一两个人的项，没法点。
 *
 * 整理是一个后台任务（`review`，由 `src/server/jobs.ts` 定期跑），一轮四步：
 * **作废、结算、出题、（自带模型时）答题再结算**。中间那步「判卷」是唯一需要判断力
 * 的一步，也是唯一切得出去的一步——题落在 `skill_review` 上，自带的模型和外部
 * agent 交上来的是同一种答卷（`REVIEW_JUDGE`）。
 *
 * **接口给外部的是题，不是改表的权限。** 出题和结算跑在整理任务里、拿着语料的
 * 写者锁（`session.ts`）；判卷不碰语料，只写题目那一行，所以外部交卷不必等派生
 * 放锁几十分钟。对照表和边只在结算时改，同一笔事务：写了决定没改边，筛选栏里
 * 别名和标准词就各数各的人。
 *
 * **向量圈组，裁判下结论。** 相似度阈值只决定圈子多大，圈进了不相干的词由裁判拆开
 * （「推荐系统」和「搜索推荐」是邻居，不是同一项能力）；裁判每次只看一组几个词，不是
 * 整份词表。标准词不由裁判选：就是组心，这组里人最多的词——留给裁判选的时候它会
 * 把通用词并进具体词（「搜索」→「搜索结果页」）。裁判只回答组里哪些词该并进组心，
 * 所以答卷只是一串布尔，形状本身带着这条不变量。
 * 并不并的判据是筛选栏的用法：招聘的人点标准词时想不想看到写了候选词的人——限定了
 * 行业或对象的具体种类要并（「销售团队管理」→「团队管理」），只是其中一个环节的不并
 * （「团队培训」）。这条线小模型划不动，所以自带的裁判用 `REVIEW_MODEL`。
 *
 * **一个词一周只判一次，一个词同时只在一道题里。** 问过裁判的组心记下时间，
 * `REVIEW_INTERVAL_DAYS` 之内不再做组心；队列里挂着的题涉及的词（组心和候选）这一轮
 * 整个不参与圈组——两道题同时判同一个词，两份答卷就会各说各的。陪组心一起被看的
 * 候选词不记时间：它们只是参考，下一轮可能自己做组心。
 *
 * **只整理有读者的组。** 筛选栏按人数排，两个单人词合成一个双人词没人会点；组心
 * 至少 `HEAD_MIN` 人的组才出题。
 */

import "@tanstack/react-start/server-only";
import { z } from "zod";
import { complete, reviewModel } from "#/server/chat";
import { embed } from "./embed";
import { type Extraction, tag } from "./extract";
import type { Report } from "./report";
import type { CorpusClient } from "./session";

/** 组心问过裁判之后多久才再做组心；也是一道题没人答的话多久作废。 */
export const REVIEW_INTERVAL_DAYS = 7;
/**
 * 两个能力词的向量相似度到这个数才圈进同一组。bge-m3 上同一项能力的不同写法
 * 多在 0.8 以上；再低会把「数据分析」和「数据仓库」这种相邻领域圈到一起——
 * 裁判能拆，但每组的词一多它就开始漏。
 */
const SIMILARITY = 0.8;
/** 一组最多几个词。圈子再大就是阈值定低了，裁判面对二十个词会成片地判成同一项。 */
const GROUP_MAX = 12;
/** 组心至少几个人才值得整理。 */
const HEAD_MIN = 3;

/**
 * 谁来判卷。`REVIEW_JUDGE` 定，和模型名一个待遇：部署方的决定，重启生效。
 *
 * - `model`：自带的模型裁判。出题、答题、结算在同一轮里连着做，队列跑完是空的。
 * - `external`：只出题和结算，题挂在队列里等外部 agent 交卷（`src/server/review.ts`）。
 * - `off`：整理不跑（拦在 `src/server/jobs.ts`）。队列里已有的题留着，切回来接着算。
 *
 * 认不出的取值当 `model`：整理停摆是没人会发现的那种坏——筛选栏照常有词，只是
 * 新写法再也不合并了。
 */
export type Judge = "model" | "external" | "off";

export function reviewJudge(): Judge {
	const value = process.env.REVIEW_JUDGE?.trim();
	if (value === "external" || value === "off" || value === "model")
		return value;
	if (value)
		console.error(
			`REVIEW_JUDGE=${value} 认不出，按 model 处理（自带模型判卷）`,
		);
	return "model";
}

/** 裁判在库里的写法：自带模型是 `model:<模型名>`，外部 agent 是 `agent:<名字>`。 */
function modelJudge(model: string): string {
	return `model:${model}`;
}

/**
 * 外部裁判自报的名字，收窄成库里的写法；不合规矩的返回 null。
 *
 * 名字只作显示（管理页上「这条是谁判的」），所以只要求它是个短标识：接口那一侧
 * 不必再想一遍什么算合法，这件事只有这一处知道。
 */
export function agentJudge(name: unknown): string | null {
	if (typeof name !== "string") return null;
	const trimmed = name.trim();
	return /^[A-Za-z0-9._-]{1,40}$/.test(trimmed) ? `agent:${trimmed}` : null;
}

/**
 * 判卷的标准。发给自带模型的是它，通过接口交给外部 agent 的也是它
 * （`src/server/review.ts` 的 `guide`）——**标准只有一份**，改了这段字两种裁判
 * 一起变。
 */
export const GUIDE = `你在整理人才库从简历里抽出来的能力词，整理的结果给筛选栏用：招聘的人点一个标准词，看到所有具备这项能力的人。第一行是标准词，后面每行是一个候选词，括号里是写了它的人数。逐个判断每个候选词该不该并进标准词。

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
 * 逐词给理由再下结论，不是直接列名单：让裁判一次列名单，它面对十来个相近的候选
 * 会整片说是或整片说否；逐词说完理由再判，每个词各判各的。理由只为约束判断，
 * 收窄时不读。
 */
const SCHEMA = z.object({
	judgments: z.array(
		z.object({ word: z.string(), why: z.string(), alias: z.boolean() }),
	),
});

/** 一个词的决定：它的标准词（等于自己就是标准词）、上次整理的时间，和判它的裁判。 */
export type Decision = { canonical: string; reviewedAt: Date; judge: string };
export type Table = Map<string, Decision>;

/** 题里的一个候选词，和出题那一刻写了它的人数。 */
type Candidate = { word: string; people: number };

/** 队列里的一道题。 */
type Question = {
	id: number;
	head: string;
	candidates: Candidate[];
	askedAt: Date;
};

export async function read(client: CorpusClient): Promise<Table> {
	const { rows } = await client.query<{
		word: string;
		canonical: string;
		reviewed_at: Date;
		judge: string;
	}>("select word, canonical, reviewed_at, judge from skill_alias");
	const table: Table = new Map(
		rows.map((row) => [
			row.word,
			{
				canonical: row.canonical,
				judge: row.judge,
				reviewedAt: row.reviewed_at,
			},
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
		`insert into skill_alias (word, canonical, reviewed_at, judge)
		 select * from unnest($1::text[], $2::text[], $3::timestamptz[], $4::text[])
		 on conflict (word) do update
		 set canonical = excluded.canonical,
		     reviewed_at = excluded.reviewed_at,
		     judge = excluded.judge`,
		[
			decisions.map(([word]) => word),
			decisions.map(([, decision]) => decision.canonical),
			decisions.map(([, decision]) => decision.reviewedAt),
			decisions.map(([, decision]) => decision.judge),
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

/**
 * 把裁判的原话收窄成组心的别名：只认这道题的候选词里判成 true 的，其余当没说。
 *
 * **自带模型和外部 agent 走的是这同一处。** 外部交上来的东西比模型的更不可信，
 * 不给它第二个入口；接口那一侧只把原话原样存进题里，不在写入时收窄。
 */
export function conform(raw: unknown, candidates: string[]): string[] {
	if (typeof raw !== "object" || raw === null) return [];
	const judgments = (raw as { judgments?: unknown }).judgments;
	const allowed = new Set(candidates);
	const out: string[] = [];
	for (const item of Array.isArray(judgments) ? judgments : []) {
		if (typeof item !== "object" || item === null) continue;
		const judgment = item as { word?: unknown; alias?: unknown };
		if (judgment.alias !== true) continue;
		const word = tag(judgment.word);
		if (allowed.has(word) && !out.includes(word)) out.push(word);
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
	judge: string,
): [string, Decision][] {
	const changed = new Map<string, Decision>();
	const decide = (word: string) => {
		const decision: Decision = { canonical: head, judge, reviewedAt: now };
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

/** 一道题发给裁判时长的样子。人数就在题上，不另查一遍语料。 */
function promptInput(question: Question): string {
	return [
		`标准词：${question.head}`,
		...question.candidates.map((one) => `${one.word}（${one.people} 人）`),
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
 * 标准词一定已经是一条说法：它是组心，组心来自出题那一轮的词表，词表来自边。同一段
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

/** 一道题还没过期的判据，`asked_at` 上的那一句。两处读队列的地方共用它。 */
const FRESH = `asked_at > now() - interval '${REVIEW_INTERVAL_DAYS} days'`;

type Row = {
	id: number;
	head: string;
	candidates: Candidate[];
	asked_at: Date;
	judge: string | null;
	answer: unknown;
};

function question(row: Row): Question {
	return {
		askedAt: row.asked_at,
		candidates: row.candidates,
		head: row.head,
		id: row.id,
	};
}

/**
 * 队列里还等着人答的题，最早出的在前。
 *
 * 两个读者：外部裁判拉题（`src/server/review.ts`），以及自带模型答题——模型答的
 * 是**所有**没答的题，不只是这一轮刚出的那些，于是上一次端点抖动漏掉的题下一轮
 * 会补上，从 `external` 切回 `model` 时挂着的题也接得上。
 */
export async function openQuestions(
	client: CorpusClient,
	limit?: number,
): Promise<Question[]> {
	const { rows } = await client.query<Row>(
		`select id, head, candidates, asked_at, judge, answer
		 from skill_review
		 where judge is null and ${FRESH}
		 order by asked_at, id
		 ${limit === undefined ? "" : "limit $1"}`,
		limit === undefined ? [] : [limit],
	);
	return rows.map(question);
}

/** 一次交卷的下场。题不在了和已经有人答过分开说：交卷的一方要据此决定重不重试。 */
export type Submission = "accepted" | "missing" | "taken";

/**
 * 把一份答卷记在题上。**只写题这一行**，不碰对照表也不碰边——那两样只在结算时改，
 * 而结算拿着语料的写者锁。所以外部交卷不必等派生放锁。
 *
 * 先到先得：一道题只有第一份答卷落下，第二份得到 `taken`。不投票、不仲裁——两份
 * 答卷不一致时挑哪一份都得有个说法，而「先到的算」是唯一不需要说法的那个。
 */
export async function submitAnswer(
	client: CorpusClient,
	id: number,
	judge: string,
	judgments: unknown,
): Promise<Submission> {
	const { rowCount } = await client.query(
		`update skill_review set judge = $2, answer = $3
		 where id = $1 and judge is null and ${FRESH}`,
		[id, judge, JSON.stringify({ judgments })],
	);
	if (rowCount) return "accepted";
	const { rows } = await client.query<{ judge: string | null }>(
		`select judge from skill_review where id = $1 and ${FRESH}`,
		[id],
	);
	return rows[0]?.judge ? "taken" : "missing";
}

/** 到期没人答的题作废：一周没人来判，说明这一轮没有裁判，下一轮重新出。 */
async function expire(client: CorpusClient, report: Report): Promise<void> {
	const { rowCount } = await client.query(
		`delete from skill_review where judge is null and not (${FRESH})`,
	);
	if (rowCount)
		report(`  ${rowCount} 道题过了 ${REVIEW_INTERVAL_DAYS} 天没人答，作废`);
}

/**
 * 把答过的题结算掉：收窄答卷、更新对照表、边改指标准词、题从队列里删掉。
 *
 * 三样在同一笔事务里。写了决定没改边，筛选栏里别名和标准词就各数各的人，而派生按
 * 新表写的新段又只有标准词——同一个词两种答案；题没删掉，下一轮会把同一份答卷再
 * 结算一遍。
 */
async function settle(client: CorpusClient, report: Report): Promise<void> {
	const { rows } = await client.query<Row>(
		`select id, head, candidates, asked_at, judge, answer
		 from skill_review where judge is not null order by id`,
	);
	if (rows.length === 0) return;

	const now = new Date();
	const table = await read(client);
	const changed = new Map<string, Decision>();
	const merged: [string, string][] = [];
	const byJudge = new Map<string, number>();
	for (const row of rows) {
		const aliases = conform(
			row.answer,
			row.candidates.map((one) => one.word),
		);
		// `judge is not null` 是这条查询的谓词，所以这一列在这里一定有值
		const judge = row.judge as string;
		for (const [word, decision] of merge(table, row.head, aliases, now, judge))
			changed.set(word, decision);
		merged.push(...aliases.map((alias): [string, string] => [alias, row.head]));
		byJudge.set(judge, (byJudge.get(judge) ?? 0) + 1);
	}

	await client.query("begin");
	try {
		await write(client, [...changed]);
		/*
		 * 改指哪些边由**最终的决定**说了算，不由这一批答卷说了算：同一个词先后
		 * 被两道题判过时，表里留下的是后一条决定，边也该跟着它走。
		 */
		await repoint(
			client,
			[...changed]
				.filter(([word, decision]) => decision.canonical !== word)
				.map(([word, decision]): [string, string] => [
					word,
					decision.canonical,
				]),
		);
		await client.query("delete from skill_review where id = any($1::int[])", [
			rows.map((row) => row.id),
		]);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}

	const who = [...byJudge]
		.map(([judge, count]) => `${judge} ${count} 道`)
		.join("、");
	report(
		merged.length
			? `  结算 ${rows.length} 道题（${who}），合并 ${merged.length} 个写法：`
			: `  结算 ${rows.length} 道题（${who}），没有要合并的写法`,
	);
	for (const [alias, canonical] of merged)
		report(`    ${alias} → ${canonical}`);
}

/**
 * 出题：到期的词圈组，每组落一行。
 *
 * 队列里挂着的题涉及的词整个不参与这一轮圈组——一个词同时出现在两道题里，两份
 * 答卷就会各说各的，而结算时挑哪一份都得有个说法。
 */
async function ask(client: CorpusClient, report: Report): Promise<void> {
	const table = await read(client);
	const all = await vocabulary(client);
	const { rows: open } = await client.query<{
		head: string;
		candidates: Candidate[];
	}>(`select head, candidates from skill_review where ${FRESH}`);
	const busy = new Set(
		open.flatMap((row) => [row.head, ...row.candidates.map((one) => one.word)]),
	);
	report(
		`  能力词 ${all.words.length} 个，对照表已有 ${table.size} 个词的决定；` +
			`队列里挂着 ${open.length} 道题`,
	);
	if (all.words.length === 0) return;

	const free = [...all.words.keys()].filter(
		(index) => !busy.has(all.words[index] as string),
	);
	const words = free.map((index) => all.words[index] as string);
	const counts = free.map((index) => all.counts[index] as number);
	const overdue = Date.now() - REVIEW_INTERVAL_DAYS * 86_400_000;
	const due = new Set(
		words.filter((word) => {
			const decision = table.get(word);
			return !decision || decision.reviewedAt.getTime() <= overdue;
		}),
	);
	const circles = words.length
		? groups(words, counts, await embed(words, report), due)
		: [];
	report(
		`  组心至少 ${HEAD_MIN} 人、相似度 ${SIMILARITY} 以上、` +
			`${REVIEW_INTERVAL_DAYS} 天内没整理过，圈成 ${circles.length} 组`,
	);
	if (circles.length === 0) return;

	const people = new Map(
		words.map((word, index) => [word, counts[index] ?? 0]),
	);
	/*
	 * 撞上 `head` 的唯一约束就出声：挂着题的词已经整个不参与圈组，撞上说明这两条
	 * 规则之间漏了一处，静默跳过只会让那道题永远出不来。
	 */
	await client.query(
		`insert into skill_review (head, candidates)
		 select * from unnest($1::text[], $2::jsonb[])`,
		[
			circles.map((group) => group[0] as string),
			circles.map((group) =>
				JSON.stringify(
					group
						.slice(1)
						.map((word) => ({ people: people.get(word) ?? 0, word })),
				),
			),
		],
	);
}

/** 自带的模型裁判：把队列里没答的题一次问完，回答记在题上。 */
async function answerByModel(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const questions = await openQuestions(client);
	if (questions.length === 0) return;
	const model = reviewModel();
	report(`  自带模型 ${model} 判 ${questions.length} 道题`);

	const inputs = questions.map(promptInput);
	const payloads = await complete(model, GUIDE, SCHEMA, inputs, "整理", report);
	// 答不出合法 JSON 的那几道留在队列里，下一轮再问（`complete` 已经说过是哪几道）
	const answered = questions
		.map(
			(one, index) => [one.id, payloads.get(inputs[index] as string)] as const,
		)
		.filter(([, payload]) => payload !== undefined);
	if (answered.length === 0) return;
	await client.query(
		`update skill_review r set judge = a.judge, answer = a.answer
		 from unnest($1::int[], $2::text[], $3::jsonb[]) as a(id, judge, answer)
		 where r.id = a.id and r.judge is null`,
		[
			answered.map(([id]) => id),
			answered.map(() => modelJudge(model)),
			answered.map(([, payload]) => JSON.stringify(payload)),
		],
	);
}

/** 整理一轮：作废、结算、出题，自带模型还要答题再结算一次。过程报出来。 */
export async function review(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const judge = reviewJudge();
	await expire(client, report);
	await settle(client, report);
	await ask(client, report);
	if (judge === "model") {
		await answerByModel(client, report);
		await settle(client, report);
		return;
	}
	const waiting = await openQuestions(client);
	report(
		`  判卷归外部（REVIEW_JUDGE=external），队列里 ${waiting.length} 道题等人答`,
	);
}
