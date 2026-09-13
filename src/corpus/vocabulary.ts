/**
 * 能力词整理：作废过期题、结算答卷、出题，再由配置的裁判作答。
 * 词表与技能边由写者会话锁串行保护，结算在同一笔事务中提交。
 * 归并和归属规则见 vocabulary-rules.ts；模型及外部裁判共用 GUIDE。
 */

import "@tanstack/react-start/server-only";
import { z } from "zod";
import { complete, reviewModel } from "#/server/chat";
import { embed } from "./embed";
import type { Report } from "./report";
import type { CorpusClient } from "./session";
import {
	conform,
	type Decision,
	groups,
	HEAD_MIN,
	type Member,
	merge,
	SIMILARITY,
	type Table,
	validate,
} from "./vocabulary-rules";

/** 一个词判过之后多久才再做组心；也是一道题没人答的话多久作废。 */
export const REVIEW_INTERVAL_DAYS = 7;
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
	validate(table);
	return table;
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

/** 一道题发给裁判时长的样子。人数就在题上，不另查一遍语料。 */
function promptInput(words: Member[]): string {
	return words.map((one) => `${one.word}（${one.people} 人）`).join("\n");
}

/**
 * 让自带的模型判一批题，按题序返回它的原话；答不出合法 JSON 的那道是 undefined
 * （`complete` 已经说过是哪道）。整理的答题一步和整理质量验收（`scripts/eval-review.ts`）
 * 共用它：验收量的正是这一步，提示词、模型、温度都和整理时一样。
 */
export async function askModel(
	questions: Member[][],
	report: Report,
): Promise<(unknown | undefined)[]> {
	const inputs = questions.map(promptInput);
	const payloads = await complete(
		reviewModel(),
		GUIDE,
		SCHEMA,
		inputs,
		"整理",
		report,
	);
	return inputs.map((input) => payloads.get(input));
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

/** 在一条语句里迁移技能边；目标缺失会触发非空约束，整条语句回滚。 */
async function repoint(client: CorpusClient, moves: [string, string][]) {
	if (moves.length === 0) return;
	await client.query(
		`with moved as (
		   delete from experience_phrase ep
		   using phrase w, unnest($1::text[], $2::text[]) as m(word, canonical)
		   where ep.route = 'skill' and ep.phrase_id = w.id and w.text = m.word
		   returning ep.experience_id,
		     (select id from phrase where text = m.canonical) as phrase_id
		 )
		 insert into experience_phrase (experience_id, route, phrase_id, involvement)
		 select experience_id, 'skill', phrase_id, null from moved
		 on conflict do nothing`,
		[moves.map(([word]) => word), moves.map(([, canonical]) => canonical)],
	);
}

/** 登记结算所需且尚未存在的说法，与词表和边在同一笔事务中写入。 */
async function enroll(
	client: CorpusClient,
	words: string[],
	vectors: number[][],
) {
	if (words.length === 0) return;
	await client.query(
		`insert into phrase (text, embedding)
		 select * from unnest($1::text[], $2::halfvec[])
		 on conflict (text) do nothing`,
		[words, vectors.map((vector) => `[${vector.join(",")}]`)],
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
 * 结算一遍。结算所需的目标说法在同一笔事务中登记。
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
	const targets = [...new Set([...changed.values()].map((d) => d.canonical))];
	const { rows: absent } = await client.query<{ text: string }>(
		`select text from unnest($1::text[]) as required(text)
		 where not exists (select 1 from phrase p where p.text = required.text)`,
		[targets],
	);
	const missing = absent.map((row) => row.text);
	// 网络请求在事务外完成；写者会话锁保证准备期间语料不变。
	const vectors = await embed(missing, report);

	await client.query("begin");
	try {
		await enroll(client, missing, vectors);
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

	const payloads = await askModel(
		questions.map((one) => one.words),
		report,
	);
	// 答不出合法 JSON 的那几道留在队列里，下一轮再问
	const answered = questions
		.map((one, index) => [one.id, payloads[index]] as const)
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
