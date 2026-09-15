/**
 * 短说法的释义：整理出的释义题。给技能、做过的事、岗位名、序列名这四类短说法各写
 * 一句「它指什么」，落进 `phrase_gloss`；判定时重排模型读「说法：释义」而不是光秃秃
 * 的四个字（为什么见 `db/schema.ts` 的 `phraseGloss`）。
 *
 * 释义是词的属性，写一次永远有效，不到期重写；只有语料里新来的、还没释义的说法
 * 才出题。出题按向量把相近的说法凑成一批：界线是对着邻居才写得出来的——「客户开发」
 * 和「服务端开发」在同一批里，写的人自然会把「销售」和「服务器程序」写出来。
 */

import "@tanstack/react-start/server-only";
import { z } from "zod";
import { complete, reviewModel } from "#/server/chat";
import {
	answered,
	busyWords,
	byJudge,
	type Member,
	modelJudge,
	openQuestions,
	pose,
	promptOf,
	recordAnswers,
	remove,
} from "./questions";
import type { Report } from "./report";
import type { CorpusClient } from "./session";
import { tag } from "./tag";

/** 写释义的那四类。整段原文本来就是一段话，部门路径答的是「待过哪儿」，都不写。 */
export const GLOSSED_ROUTES = ["skill", "did", "title", "seq"] as const;

/** 一批几个说法。裁判一次面对几十个相近的词还写得出界线；再多就开始互相抄。 */
export const BATCH = 40;

/**
 * 释义最长几个字。标准里要的是三十字以内的一句话；收窄放到两倍，多写了几个字的
 * 句子仍是释义，不为此重出。超过这个数的是在写简介。
 */
export const GLOSS_MAX = 60;

/** 发给裁判的标准。自带模型和外部 agent 读的是同一段字，改了这段两种裁判一起变。 */
export const GLOSS_GUIDE = `## 背景

这是一个公司内部的人才库。招聘的人输入一个词（「服务端开发」「推荐算法」），系统在每个人简历里读出来的短标签里找意思相同的：能力词、做过的事、岗位名、序列名，都是几个字。判定用的模型读的是「标签：释义」——它判一个词对一段话判得准，判四个字对四个字就只会数有几个字一样，「客户开发」会被它当成「服务端开发」。你写的这一句释义，就是让它读到那段话。

## 任务

下面是一组写法相近的标签，括号里是写了它的人数。给每个标签写一句释义：它指哪个行当里的什么活；岗位名写这个岗位做什么；序列名写这条序列做什么。每个标签一条 judgment：word 原样照抄，gloss 一句话。每个标签都要有一条。

## 写法

- 一句话，不超过 30 个字。不重复标签本身，不用「指」「是」「即」开头，直接写内容。
- 先说行当、对象，再说活。同一组里相近的标签，把它们分开的那个词一定要写进去：「客户开发」写「销售拓展新客户、促成签约」，「服务端开发」写「编写运行在服务器上的程序与接口」，「前端开发」写「开发网页和 App 的界面与交互」。
- 标签含糊、能指好几件事的（「开发」「运营」），按招聘语境里最常见的那一种写，不罗列。
- 不写程度、不写评价、不写「相关」「等」这类字。`;

/**
 * 逐词一条。schema 里不写长度：限制只写在收窄的地方（`conformGlosses`），
 * 改了限制不该让已经交上来的答卷失效。
 */
const SCHEMA = z.object({
	judgments: z.array(z.object({ word: z.string(), gloss: z.string() })),
});

/**
 * 收窄一份答卷：题里的词 → 它的释义。
 *
 * 丢掉的：不在题里的词；空的；超过 `GLOSS_MAX` 的；和词本身一样的；带换行的
 * （一句话没有换行）。裁判把词又抄了一遍在前面（「客户开发：销售……」）的，把那
 * 一截去掉——判定时是系统把词和释义拼起来读的。同一个词答了两次取先答的。
 */
export function conformGlosses(
	payload: unknown,
	words: string[],
): Map<string, string> {
	const out = new Map<string, string>();
	const parsed = SCHEMA.safeParse(payload);
	if (!parsed.success) return out;
	const asked = new Set(words);
	for (const { word, gloss } of parsed.data.judgments) {
		if (!asked.has(word) || out.has(word)) continue;
		const text = tag(gloss)
			.replace(new RegExp(`^${escapeRegExp(word)}\\s*[：:]\\s*`), "")
			.replace(/[。.]$/, "");
		if (!text || text === word || text.includes("\n")) continue;
		if ([...text].length > GLOSS_MAX) continue;
		out.set(word, text);
	}
	return out;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 出题：语料里那四类上还没释义、也不在队列里的说法，按向量凑成一批批。
 *
 * 凑批在库里做：每次拿字序最前的一条当锚，取离它最近的 `BATCH` 条成一批，从池里
 * 拿走，直到池空。几万条说法第一次是几百次扫描，之后每天只有新来的几十条。
 */
export async function askGlosses(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const busy = await busyWords(client, "gloss");
	// 临时表跟着这条会话走；上一轮半路断掉留下的先清掉
	await client.query("drop table if exists gloss_pool");
	await client.query(
		`create temp table gloss_pool as
		 select p.id, p.text, p.embedding, count(distinct e.emp_id)::int as people
		 from phrase p
		 join experience_phrase ep on ep.phrase_id = p.id and ep.route = any($1::text[])
		 join experience e on e.id = ep.experience_id
		 where not exists (select 1 from phrase_gloss g where g.text = p.text)
		   and p.text <> all($2::text[])
		 group by p.id`,
		[[...GLOSSED_ROUTES], [...busy]],
	);
	const { rows: total } = await client.query<{ n: number }>(
		"select count(*)::int as n from gloss_pool",
	);
	const pending = total[0]?.n ?? 0;
	report(`  ${pending} 条短说法还没有释义，队列里挂着 ${busy.size} 个`);
	const batches: Member[][] = [];
	for (;;) {
		const { rows } = await client.query<Member>(
			`delete from gloss_pool
			 where id in (
			   select id from gloss_pool
			   order by embedding <=> (select embedding from gloss_pool order by text limit 1)
			   limit $1)
			 returning text as word, people`,
			[BATCH],
		);
		if (rows.length === 0) break;
		batches.push(rows);
	}
	await client.query("drop table if exists gloss_pool");
	if (batches.length === 0) return;
	await pose(client, "gloss", batches);
	report(`  出了 ${batches.length} 道释义题，每道最多 ${BATCH} 个说法`);
}

/**
 * 结算：释义落表，这些说法的分数缓存清掉，题从队列里删。三样一笔事务。
 *
 * 分数是按判定时读到的字打的：没释义时读的是四个字，有了释义读的是一段话，旧分
 * 对新字不成立。按文本找 `phrase` 行再删 `phrase_relevance`——释义按文本存，说法
 * 表换过嵌入空间之后 id 变了也照样对得上。
 */
export async function settleGlosses(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const rows = await answered(client, "gloss");
	if (rows.length === 0) return;
	const now = new Date();
	const written = new Map<string, { gloss: string; judge: string }>();
	let missed = 0;
	for (const row of rows) {
		const words = row.words.map((one) => one.word);
		const glosses = conformGlosses(row.answer, words);
		missed += words.length - glosses.size;
		for (const [word, gloss] of glosses)
			written.set(word, { gloss, judge: row.judge });
	}
	const entries = [...written];
	const texts = entries.map(([text]) => text);
	await client.query("begin");
	try {
		if (entries.length > 0) {
			await client.query(
				`insert into phrase_gloss (text, gloss, written_at, judge)
				 select * from unnest($1::text[], $2::text[], $3::timestamptz[], $4::text[])
				 on conflict (text) do update
				 set gloss = excluded.gloss,
				     written_at = excluded.written_at,
				     judge = excluded.judge`,
				[
					texts,
					entries.map(([, one]) => one.gloss),
					entries.map(() => now),
					entries.map(([, one]) => one.judge),
				],
			);
			await client.query(
				`delete from phrase_relevance r using phrase p
				 where p.id = r.phrase_id and p.text = any($1::text[])`,
				[texts],
			);
		}
		await remove(
			client,
			rows.map((row) => row.id),
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
	report(
		`  结算 ${rows.length} 道释义题（${byJudge(rows)}），写下 ${written.size} 条释义` +
			(missed ? `，${missed} 个说法没答或答得不合规矩，下一轮重出` : ""),
	);
}

/** 自带的模型裁判：把队列里没答的释义题一次问完，回答记在题上。 */
export async function answerGlossesByModel(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const questions = (await openQuestions(client)).filter(
		(one) => one.kind === "gloss",
	);
	if (questions.length === 0) return;
	const model = reviewModel();
	report(`  自带模型 ${model} 写 ${questions.length} 道释义题`);
	const inputs = questions.map((one) => promptOf(one.words));
	const payloads = await complete(
		model,
		GLOSS_GUIDE,
		SCHEMA,
		inputs,
		"释义",
		report,
	);
	await recordAnswers(
		client,
		modelJudge(model),
		questions.map((one, index) => [
			one.id,
			payloads.get(inputs[index] as string),
		]),
	);
}

/** 有多少条短说法已有释义、多少条还没有。任务台那张卡片报的数。 */
export async function glossCounts(
	client: CorpusClient,
): Promise<{ glossable: number; glossed: number }> {
	const { rows } = await client.query<{ glossable: number; glossed: number }>(
		`select count(*)::int as glossable,
		        count(*) filter (where exists
		          (select 1 from phrase_gloss g where g.text = p.text))::int as glossed
		 from phrase p
		 where exists (select 1 from experience_phrase ep
		               where ep.phrase_id = p.id and ep.route = any($1::text[]))`,
		[[...GLOSSED_ROUTES]],
	);
	return rows[0] ?? { glossable: 0, glossed: 0 };
}
