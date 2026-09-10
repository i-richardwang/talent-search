/**
 * 能力词的词表：每个词的标准写法，和标准词属于哪个更宽的词。由整理任务定期整理。
 *
 * 抽出来的能力词是开放词表，同一项能力有好几种写法（「推荐算法」「个性化推荐」
 * 「Recommendation」）；招聘的人要的粗细又是当场定的：今天要「数据分析师」，明天要
 * 「销售分析师」。语料预知不了查询的粗细，所以**存最细的那一档，粗的在查的时候聚出来**：
 * 细的能聚成粗的，粗的还原不成细的。整理因此只做两件事，两件都不丢掉词里的限定：
 *
 * - **认写法**：同一件事的不同写法归到一个标准写法（`canonical`），能力词那一路的边随之
 *   改指标准词。这是无损的——它们本来就指同一件事。
 * - **认归属**：一个词是更宽的词的一种（「销售数据分析」属于「数据分析」），具体的词原样
 *   留在人身上，只在标准词上多一条 `parent`。筛选栏和查询沿它往上聚（`src/search/search.ts`
 *   的 `FACT_COLUMNS.skills`）：点「数据分析」看到做过各种数据分析的人，点「销售数据分析」
 *   只看到销售那一种。更宽的词可以是语料里没人写过的，裁判起的名字。
 *
 * 整理是一个后台任务（`review`，由 `src/server/jobs.ts` 定期跑），一轮四步：
 * **作废、结算、出题、（自带模型时）答题再结算**。中间那步「判卷」是唯一需要判断力
 * 的一步，也是唯一切得出去的一步——题落在 `skill_review` 上，自带的模型和外部
 * agent 交上来的是同一种答卷（`REVIEW_JUDGE`）。
 *
 * **接口给外部的是题，不是改表的权限。** 出题和结算跑在整理任务里、拿着语料的
 * 写者锁（`session.ts`）；判卷不碰语料，只写题目那一行，所以外部交卷不必等派生
 * 放锁几十分钟。词表和边只在结算时改，同一笔事务：写了决定没改边，筛选栏里
 * 别名和标准词就各数各的人。
 *
 * **向量圈组，裁判下结论。** 相似度阈值只决定圈子多大，圈进了不相干的词由裁判说明
 * （「推荐系统」和「搜索推荐」是邻居，不是同一项能力）；裁判每次只看一组几个词，不是
 * 整份词表。题里的词一律平等：裁判对每个词回答「和组里哪个词是同一件事」「属于哪个
 * 更宽的词」。标准写法不由裁判选——同一件事的几个词里人最多的那个做标准写法，留给
 * 裁判选的时候它会把通用词并进具体词（「搜索」→「搜索结果页」）。归属的名字由裁判起：
 * 「销售数据分析」「运营数据分析」共同的更宽的词是「数据分析」，语料里未必有人这么写过，
 * 只能由裁判说出来；收窄只拦住方向反了的归属（更宽的词不能含着这个词）。
 * 这条线小模型划不动，所以自带的裁判用 `REVIEW_MODEL`。
 *
 * **词表里只有一种词。** 人写的词和裁判起的名字都是标准词：人数都按它下面的人算
 * （筛选栏同一口径），都一样圈组、出题、到期再判。裁判起的「销售数据分析」下一次到期时
 * 会被拿去问它属于什么，两组各自起的「数据分析」「数据分析能力」会被圈到一组问是不是
 * 同一件事。这一轮的词表就是表里的标准词加上语料里还没进表的词（`vocabulary`）。
 *
 * **一个词一周只判一次，一个词同时只在一道题里。** 判过的词记下时间，
 * `REVIEW_INTERVAL_DAYS` 之内不再做组心；队列里挂着的题涉及的词这一轮整个不参与圈组——
 * 两道题同时判同一个词，两份答卷就会各说各的。
 *
 * **只整理有读者的组。** 筛选栏按人数排，两个单人词合成一个双人词没人会点；组心
 * 至少 `HEAD_MIN` 人（连同它下面的词）的组才出题。
 */

import "@tanstack/react-start/server-only";
import { z } from "zod";
import { complete, reviewModel } from "#/server/chat";
import { embed } from "./embed";
import { type Extraction, MAX_TAG_LEN, tag } from "./extract";
import type { Report } from "./report";
import type { CorpusClient } from "./session";

/** 一个词判过之后多久才再做组心；也是一道题没人答的话多久作废。 */
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
export const GUIDE = `## 背景

这是一个公司内部的人才库。招聘的人在筛选栏里点能力词找人，点完再读简历原话确认。筛选栏里的词来自简历：同一项能力有好几种写法，同一个方向的词又有宽有细。系统的做法是每个人身上只留最细的词，宽的在点的时候沿着「属于」关系聚出来——点「数据分析」看到做过各种数据分析的人，点「销售数据分析」只看到做过销售那一种的人。为此词表要记两件事：哪些词是同一件事的不同写法，每个词属于哪个更宽的词。这两件事由你来判。

两种判断的代价不一样。判成同一件事是合并：人身上的词会被换成标准写法，原来的写法从此没有了，以后拆不回来；错并了，一批人在他们真正的能力词下就消失了。归属只是多一条聚合关系，细的词还留在人身上，判错了下一轮能改。所以同一件事拿不准就不写，归属拿不准可以写。

## 任务

下面是一组写法相近的能力词，括号里是有这项能力的人数（写了它或它下面任一个词的人）。对每个词判两件事：sameAs 和 parent。每个词一条 judgment：word 原样照抄；why 先用一句话说理由；再给 sameAs 和 parent，没有的写空字符串。每个词都要有一条。

## 同一件事（sameAs）

判据只有一个：招聘的人拿这两个词找人，找的是不是同一批人。是，就是同一件事，写这组里的那个词。同一件事的几个词可以互相指，最终用哪个写法由系统按人数定，你不用选。

同一件事一般是这几种：同义词（「人员管理」「团队管理」）、中英文（「推荐算法」「Recommendation」）、缩写、语序颠倒而意思不变（「销售策略运营」「销售运营策略」；「活动培训」和「培训活动」意思变了，不算）、多了「工作」「能力」「统筹」这类不改变意思的字。

不是同一件事的：
- 一个比另一个细。「销售数据分析」找的人只是「数据分析」找的人的一部分。宽的和细的永远不合并，细的属于宽的。
- 去掉限定语后一样的两个词是兄弟。「销售数据分析」和「运营数据分析」找的是两批人，各自保留，各自属于「数据分析」。
- 相邻的另一件事。「营销策略」和「运营策略」、「推荐系统」和「搜索推荐」是邻居，找的人不同，也不互相属于。

## 属于（parent）

一个词属于更宽的词，指它是更宽的词的一种：只是限定了行业、对象、产品或渠道。「销售数据分析」属于「数据分析」，「技术招聘」属于「招聘」，「品牌营销」属于「营销」。判据同样看人：点更宽的词的人，想不想看到有这个词的人。「团队培训」不属于「团队管理」，做过培训不等于管过团队；「数据分析报告」不属于「数据分析」，写报告不等于会分析。环节、产出物、工具、平台都不属于它服务的那项能力。

更宽的词可以不在这组里，也可以是简历里没人写过的，由你起名。这个名字会直接成为筛选栏里的一项，所以它得是招聘的人会点的能力词：招聘要求里「熟悉 ___」「有 ___ 经验」能填进去的业务通名，一般不超过八个字，不带动作、程度词，不带「能力」「相关」「工作」这类字。「销售数据分析」的更宽的词写「数据分析」，不写「数据相关」「分析能力」。别的组也在各自起名，用这项能力最通行的叫法，几组起出来的才会是同一个词。

写最近的一层：「电商销售数据分析」属于「销售数据分析」，不直接写「数据分析」。更宽的词永远是更宽的那个：「数据分析」不属于「销售数据分析」。`;

/**
 * 逐词给理由再下结论，不是直接列名单：让裁判一次列名单，它面对十来个相近的候选
 * 会整片说是或整片说否；逐词说完理由再判，每个词各判各的。理由只为约束判断，
 * 收窄时不读。schema 里不写长度和枚举：限制只写在收窄的地方（`conform`）。
 */
const SCHEMA = z.object({
	judgments: z.array(
		z.object({
			word: z.string(),
			why: z.string(),
			sameAs: z.string(),
			parent: z.string(),
		}),
	),
});

/**
 * 一个词的决定：它的标准写法（等于自己就是标准词）、标准词属于哪个更宽的词
 * （别名上恒为 null）、上次判它的时间，和判它的裁判。
 */
export type Decision = {
	canonical: string;
	parent: string | null;
	reviewedAt: Date;
	judge: string;
};
export type Table = Map<string, Decision>;

/** 题里的一个词，和出题那一刻它下面的人数。 */
type Member = { word: string; people: number };

/** 队列里的一道题。 */
type Question = {
	id: number;
	words: Member[];
	askedAt: Date;
};

/**
 * 读整张表。
 *
 * 表被手改坏的三种样子在这里出声拒绝：别名的标准词自己又是别名、归属指向一个别名、
 * 归属成环。`merge` 不会写出这三种行；静默取其一只会让筛选栏少一批人而没人知道。
 */
export async function read(client: CorpusClient): Promise<Table> {
	const { rows } = await client.query<{
		word: string;
		canonical: string;
		parent: string | null;
		reviewed_at: Date;
		judge: string;
	}>("select word, canonical, parent, reviewed_at, judge from skill_term");
	const table: Table = new Map(
		rows.map((row) => [
			row.word,
			{
				canonical: row.canonical,
				judge: row.judge,
				parent: row.parent,
				reviewedAt: row.reviewed_at,
			},
		]),
	);
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
	return table;
}

/** 一个词的上一级：别名走它标准词的归属。没有就是 null。 */
function ancestor(table: Table, word: string): string | null {
	const decision = table.get(word);
	if (!decision) return null;
	return decision.canonical === word
		? decision.parent
		: (table.get(decision.canonical)?.parent ?? null);
}

/**
 * 把这些决定写回表。
 *
 * 收的是**决定本身**，不是一串词名再回表里查：查得到查不到就得有个说法，而
 * 「查不到时写个空标准词」是一行悄悄坏掉的词表。`merge` 手里本来就有决定。
 * 归属指回本表，所以裁判起的名字也在这一批里作为一行写进去；外键在语句末尾才查，
 * 一条语句里父子同时落下没有先后。
 */
async function write(client: CorpusClient, decisions: [string, Decision][]) {
	if (decisions.length === 0) return;
	await client.query(
		`insert into skill_term (word, canonical, parent, reviewed_at, judge)
		 select * from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::text[])
		 on conflict (word) do update
		 set canonical = excluded.canonical,
		     parent = excluded.parent,
		     reviewed_at = excluded.reviewed_at,
		     judge = excluded.judge`,
		[
			decisions.map(([word]) => word),
			decisions.map(([, decision]) => decision.canonical),
			decisions.map(([, decision]) => decision.parent),
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

/** 裁判对一个词说了什么，收窄之后的样子。 */
export type Verdict = { sameAs: string | null; parent: string | null };

/**
 * 把裁判的原话收窄成逐词的判断：只认这道题里的词，一个词只认第一条。
 *
 * `sameAs` 必须是题里的另一个词；`parent` 是裁判起的名字，只要求它是一条能力词
 * （规范写法、不超过 `MAX_TAG_LEN`），不是这个词自己，也不含着这个词——含着它的词
 * 比它更具体，方向反了的归属（「数据分析」属于「销售数据分析」）在这里就拦下。
 *
 * **自带模型和外部 agent 走的是这同一处。** 外部交上来的东西比模型的更不可信，
 * 不给它第二个入口；接口那一侧只把原话原样存进题里，不在写入时收窄。
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
 * 记下一道题的结论，返回决定变了的词。
 *
 * `sameAs` 连成的每一片是同一件事，片里人最多的词做标准写法；片里的其他词对到它，
 * 此前对到它们的词、归属于它们的词也一起改指它，表里于是不会出现「别名的别名」和
 * 「归属于别名」。片的归属由片里的答卷按人数投出来；它若是题里另一片的词就取那一片的
 * 标准写法，若是表里的别名就取它的标准词；沿表往上走会走回自己的归属丢掉，表里于是
 * 不会成环。归属是表里没有的词时给它落一行——它从此是一个标准词。
 *
 * 判过的每个词都记时间：裁判看过它，一周内不必再看。
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

/** 一片的归属：片里的答卷按人数投票，再按表和这道题的其他片解析成一个标准词。 */
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

/** 一道题发给裁判时长的样子。人数就在题上，不另查一遍语料。 */
function promptInput(question: Question): string {
	return question.words
		.map((one) => `${one.word}（${one.people} 人）`)
		.join("\n");
}

/**
 * 这一轮要整理的词表：每个词和它的人数，按词排序。
 *
 * **词表里只有一种词。** 人写的词和裁判起的名字在这里没有分别：都是标准词，人数都按
 * 「写了它或它下面任一个词的人」数（筛选栏同一口径，`src/server/skills.ts`），都一样
 * 圈组、出题、到期再判。所以词表是**表里的标准词，加上语料里还没进表的词**——后者是
 * 还没判过的标准词，别名不算（它的边已经改指标准词，它自己不再是筛选栏里的一项）。
 * 只从语料取词的话，裁判起的名字永远不会被再问一次：「销售数据分析」挂不到「数据分析」
 * 下面，两组各自起的「数据分析」「数据分析能力」也永远并不到一起。
 *
 * 下面一个人都没有的词不在这一轮里：没人会点它，也就没什么可整理的。
 */
async function vocabulary(client: CorpusClient) {
	const { rows } = await client.query<{ word: string; people: string }>(
		`with recursive term(word) as (
		   select word from skill_term where word = canonical
		   union
		   select p.text from phrase p
		   where exists (select 1 from experience_phrase ep
		                 where ep.phrase_id = p.id and ep.route = 'skill')
		     and not exists (select 1 from skill_term t where t.word = p.text)
		 ), under(term, word) as (
		   select word, word from term
		   union
		   select u.term, t.word from under u join skill_term t on t.parent = u.word
		 )
		 select u.term as word, count(distinct e.emp_id) as people
		 from under u
		 join phrase p on p.text = u.word
		 join experience_phrase ep on ep.phrase_id = p.id and ep.route = 'skill'
		 join experience e on e.id = ep.experience_id
		 group by u.term
		 order by u.term`,
	);
	return {
		words: rows.map((row) => row.word),
		counts: rows.map((row) => Number(row.people)),
	};
}

/**
 * 把指向这些别名的边改指各自的标准词。
 *
 * 标准词一定已经是一条说法：它是同一件事那一片里人最多的词，片里的词来自出题那一轮的
 * 词表，词表来自边。同一段既写了别名又写了标准词的，改指之后两条边撞成一条，撞的那条
 * 丢掉即可。
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
	words: Member[];
	asked_at: Date;
	judge: string | null;
	answer: unknown;
};

function question(row: Row): Question {
	return { askedAt: row.asked_at, id: row.id, words: row.words };
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
		`select id, words, asked_at, judge, answer
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
 * 把一份答卷记在题上。**只写题这一行**，不碰词表也不碰边——那两样只在结算时改，
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
 * 把答过的题结算掉：收窄答卷、更新词表、边改指标准词、题从队列里删掉。
 *
 * 三样在同一笔事务里。写了决定没改边，筛选栏里别名和标准词就各数各的人，而派生按
 * 新表写的新段又只有标准词——同一个词两种答案；题没删掉，下一轮会把同一份答卷再
 * 结算一遍。
 */
async function settle(client: CorpusClient, report: Report): Promise<void> {
	const { rows } = await client.query<Row>(
		`select id, words, asked_at, judge, answer
		 from skill_review where judge is not null order by id`,
	);
	if (rows.length === 0) return;

	const now = new Date();
	const table = await read(client);
	const changed = new Map<string, Decision>();
	const byJudge = new Map<string, number>();
	for (const row of rows) {
		const verdicts = conform(
			row.answer,
			row.words.map((one) => one.word),
		);
		// `judge is not null` 是这条查询的谓词，所以这一列在这里一定有值
		const judge = row.judge as string;
		for (const [word, decision] of merge(
			table,
			row.words,
			verdicts,
			now,
			judge,
		))
			changed.set(word, decision);
		byJudge.set(judge, (byJudge.get(judge) ?? 0) + 1);
	}
	const merged = [...changed].filter(
		([word, decision]) => decision.canonical !== word,
	);
	const placed = [...changed].filter(
		([, decision]) => decision.parent !== null,
	);

	await client.query("begin");
	try {
		await write(client, [...changed]);
		/*
		 * 改指哪些边由**最终的决定**说了算，不由这一批答卷说了算：同一个词先后
		 * 被两道题判过时，表里留下的是后一条决定，边也该跟着它走。
		 */
		await repoint(
			client,
			merged.map(([word, decision]): [string, string] => [
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
		`  结算 ${rows.length} 道题（${who}），` +
			`认成同一写法 ${merged.length} 个，认出归属 ${placed.length} 个`,
	);
	for (const [alias, decision] of merged)
		report(`    ${alias} → ${decision.canonical}`);
	for (const [word, decision] of placed)
		report(`    ${word} 属于 ${decision.parent}`);
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
	const { rows: open } = await client.query<{ words: Member[] }>(
		`select words from skill_review where ${FRESH}`,
	);
	const busy = new Set(open.flatMap((row) => row.words.map((one) => one.word)));
	const decided = all.words.filter((word) => table.has(word)).length;
	report(
		`  词表 ${all.words.length} 个词，其中 ${decided} 个已有决定；` +
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
	await client.query(
		`insert into skill_review (words) select * from unnest($1::jsonb[])`,
		[
			circles.map((group) =>
				JSON.stringify(
					group.map((word) => ({ people: people.get(word) ?? 0, word })),
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
