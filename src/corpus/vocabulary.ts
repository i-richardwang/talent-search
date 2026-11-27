/**
 * 短说法的词表：每个还没判过、此刻有人写的短说法（`term_in_use`）连同词表里最接近的几个词送进队列，
 * 判定方判它在词表里的位置（和谁是同一件事、属于哪个更宽的词、自成一项，或者不是一项
 * 能力），生效时写进 `term`。
 * 整理只写词表，不碰人身上的词：边上永远是简历里的原话。检索按词表把同一件事的几种
 * 写法当成一条说法（`src/search/phrases.ts`），标签页按宽细把一支词摆出来
 * （`src/server/terms.ts`）。
 * 校验和生效规则见 vocabulary-rules.ts；判定队列在 judgment.ts；模型和外部判定方共用 GUIDE。
 */

import "@tanstack/react-start/server-only";
import { setImmediate } from "node:timers/promises";
import type { Rejudge } from "#/lib/task";
import { embedConfigured } from "#/server/embed";
import { embed } from "./embed";
import {
	busyWords,
	byJudge,
	collect,
	judged,
	type Member,
	type Question,
	remove,
} from "./judgment";
import type { Report } from "./report";
import { guideIdentity } from "./review-guide";
import type { CorpusClient, CorpusWriter } from "./session";
import {
	conform,
	type Decision,
	nearest,
	place,
	rename,
	type Table,
	validate,
} from "./vocabulary-rules";

/**
 * 表被手改坏的几种样子在这里抛错：别名的标准词自己又是别名、归属指向一个别名、
 * 归属成环、有词指向不是能力的词。`place` 不会写出这几种行；静默取其一只会让筛选栏
 * 少一批人而没人知道。
 */
export async function read(client: CorpusClient): Promise<Table> {
	const { rows } = await client.query<{
		word: string;
		canonical: string;
		alias_sent_back: boolean;
		parent: string | null;
		excluded: boolean;
		reviewed_at: Date | null;
	}>(
		"select word, canonical, alias_sent_back, parent, excluded, reviewed_at from term",
	);
	const table: Table = new Map(
		rows.map((row) => [
			row.word,
			{
				canonical: row.canonical,
				aliasSentBack: row.alias_sent_back,
				excluded: row.excluded,
				parent: row.parent,
				reviewedAt: row.reviewed_at,
			},
		]),
	);
	validate(table);
	return table;
}

/**
 * 按决定写入词表，包含判定方命名的父词；同一语句写入父子，外键在语句末尾检查。
 */
async function write(client: CorpusClient, decisions: [string, Decision][]) {
	if (decisions.length === 0) return;
	await client.query(
		`insert into term (word, canonical, parent, excluded, reviewed_at, alias_sent_back)
		 select * from unnest(
		   $1::text[], $2::text[], $3::text[], $4::boolean[], $5::timestamptz[], $6::boolean[])
		 on conflict (word) do update
		 set canonical = excluded.canonical,
		     parent = excluded.parent,
		     excluded = excluded.excluded,
		     reviewed_at = excluded.reviewed_at,
		     alias_sent_back = excluded.alias_sent_back`,
		[
			decisions.map(([word]) => word),
			decisions.map(([, decision]) => decision.canonical),
			decisions.map(([, decision]) => decision.parent),
			decisions.map(([, decision]) => decision.excluded),
			decisions.map(([, decision]) => decision.reviewedAt),
			decisions.map(([, decision]) => decision.aliasSentBack),
		],
	);
}

/**
 * 此刻有人写的短说法（`term_in_use`），分两种：标准词（词表里的标准词和判定方起名的
 * 更宽的词，加上还没进词表的语料词）各带它下面的人数，连别名与后代一起数；别名带写了
 * 这个写法的人数。
 */
async function vocabulary(client: CorpusClient) {
	const { rows } = await client.query<{
		word: string;
		people: number;
		alias: boolean;
	}>(
		`select u.word, u.people, coalesce(t.word <> t.canonical, false) as alias
		 from term_in_use u left join term t on t.word = u.word
		 order by u.word`,
	);
	const member = ({ word, people }: Member): Member => ({ word, people });
	return {
		aliases: rows.filter((row) => row.alias).map(member),
		heads: rows.filter((row) => !row.alias).map(member),
	};
}

/**
 * 让判过的词生效，一个词一个词按收集顺序来：后一个词看到的是前一个生效之后的表。
 * 生效和删行在同一笔事务里：行没删掉，下一轮会把同一份判定再算一遍。人身上的词不动，
 * 所以这一步判错了，退回重判改回来就是改回来了，没有要恢复的东西。
 * 不成一条判断的行也删：那个词仍是没判过的，下一轮重新收集。
 */
export async function applyJudgments(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const rows = await judged(client, guideIdentity());
	if (rows.length === 0) return;

	const now = new Date();
	const table = await read(client);
	const changed = new Map<string, Decision>();
	const lines: string[] = [];
	const tally = { alone: 0, excluded: 0, invalid: 0, same: 0, under: 0 };
	for (const row of rows) {
		const verdict = conform(
			row.judgment,
			row.word,
			row.near.map((one) => one.word),
		);
		const decisions = verdict ? place(table, row.word, verdict, now) : [];
		if (!verdict || decisions.length === 0) {
			tally.invalid++;
			continue;
		}
		tally[verdict.kind]++;
		for (const [word, decision] of decisions) changed.set(word, decision);
		const own = table.get(row.word);
		if (own?.excluded) lines.push(`    ${row.word} 不是能力`);
		else if (own && own.canonical !== row.word)
			lines.push(`    ${row.word} → ${own.canonical}`);
		else if (own?.parent) lines.push(`    ${row.word} 属于 ${own.parent}`);
	}
	await client.query("begin");
	try {
		await write(client, [...changed]);
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
		`  生效 ${rows.length} 个词的判定（${byJudge(rows)}）：同一件事 ${tally.same} 个，` +
			`属于 ${tally.under} 个，自成一项 ${tally.alone} 个，不是能力 ${tally.excluded} 个` +
			(tally.invalid ? `，不成判断 ${tally.invalid} 个` : ""),
	);
	for (const line of lines) report(line);
}

/**
 * 按此刻的人数给每一项定名字（`rename`）：判定生效之后跑，合进来的写法也参与。
 * 名字换了，属于它的词跟着改挂；人身上的词不动。
 */
export async function renameItems(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const table = await read(client);
	const { rows } = await client.query<{ word: string; writers: number }>(
		"select word, writers from term_in_use where writers > 0",
	);
	const heads = new Set(
		[...table.keys()].filter((word) => table.get(word)?.canonical === word),
	);
	const changed = rename(
		table,
		new Map(rows.map((row) => [row.word, row.writers])),
	);
	if (changed.length === 0) return;
	await write(client, changed);
	const renamed = changed.filter(
		([word, decision]) => heads.has(word) && decision.canonical !== word,
	);
	report(`  按现在的人数换了 ${renamed.length} 项的名字`);
	for (const [word, decision] of renamed)
		report(`    ${word} 改叫 ${decision.canonical}`);
}

/**
 * 把人指定的范围退回成没判过：词表里的决定原样留着，照常用于检索和筛选，直到新的判定
 * 生效。一项连同它的其他写法一起退回；带细分时沿归属一层层往下。
 */
export async function sendBack(
	client: CorpusClient,
	report: Report,
	rejudge: Rejudge,
): Promise<void> {
	const { rowCount } =
		rejudge.scope === "term"
			? await client.query(
					`with recursive item(word) as (
					   select canonical from term where word = $1
					   union
					   select c.word from item i
					   join term c on c.parent = i.word and $2
					 ), returned as (
					   update term t set reviewed_at = null, alias_sent_back = t.word <> t.canonical
					   from item i where t.canonical = i.word returning t.word
					 ), discarded as (
					   delete from review_word where word in (select word from returned)
					 ) select word from returned`,
					[rejudge.word, rejudge.branch],
				)
			: await client.query(
					`with returned as (
					   update term set reviewed_at = null, alias_sent_back = word <> canonical
					   where excluded or $1 returning word
					 ), discarded as (
					   delete from review_word where word in (select word from returned)
					 ) select word from returned`,
					[rejudge.scope === "all"],
				);
	const range =
		rejudge.scope === "all"
			? "整张词表"
			: rejudge.scope === "excluded"
				? "判成不是能力的词"
				: `「${rejudge.word}」${rejudge.branch ? "连同它的细分" : ""}`;
	report(`  ${range}退回重新判定，共 ${rowCount ?? 0} 个词`);
}

/**
 * 收集：每个没判过的词（词表里还没有它，或它被退回重判）配上词表里最接近的几个标准词，
 * 写一行进队列。判过的词不自动重判：同一个词、同样的参考词、同一份标准再问一遍
 * 得不到新的东西；要重判由人指定范围（`sendBack`）。别名也是要判的词：判开了就拆出来。
 *
 * 参考词只从标准词里取，判成不是能力的不作参考。队列里还没处理完的词不参与这一轮收集——
 * 一个词在队列里有两行，两份判定就会各说各的。
 *
 * 找参考词要词的向量：嵌入端点没配就不收集，队列里已有的词照常判、照常生效。
 */
export async function collectWords(
	{ client, outsideWriter }: CorpusWriter,
	report: Report,
): Promise<void> {
	if (!embedConfigured()) {
		report("  未配置嵌入端点，找不出相近的写法，这一轮不收集要判的词");
		return;
	}
	const identity = guideIdentity();
	const vectors = new Map<string, number[]>();
	// 等嵌入期间语料可能变化。拿回写者锁后按当前词和人数组题，只补新增词的向量。
	while (true) {
		const table = await read(client);
		const all = await vocabulary(client);
		const busy = await busyWords(client, identity);
		const words = [...all.heads, ...all.aliases];
		const due = words.filter(
			(one) => !busy.has(one.word) && !table.get(one.word)?.reviewedAt,
		);
		const pool = all.heads.filter((one) => !table.get(one.word)?.excluded);
		const missing = [
			...new Set([...pool, ...due].map((one) => one.word)),
		].filter((word) => !vectors.has(word));
		if (due.length && missing.length) {
			const embedded = await outsideWriter(() => embed(missing, report));
			for (const [i, word] of missing.entries())
				vectors.set(word, embedded[i] as number[]);
			continue;
		}
		const decided = words.filter(
			(one) => table.get(one.word)?.reviewedAt,
		).length;
		report(
			`  词表 ${words.length} 个词，其中 ${decided} 个已经判过；队列里还有 ${busy.size} 个词`,
		);
		report(`  ${due.length} 个词要判`);
		if (!due.length) return;
		const vectorOf = (one: Member) => vectors.get(one.word) as number[];
		const people = new Map(pool.map((one) => [one.word, one.people]));
		const near = nearest(
			pool.map((one) => one.word),
			pool.map(vectorOf),
		);
		const questions: Question[] = [];
		for (const one of due) {
			// 几万个词各扫一遍候选要几分钟：隔一会儿让出事件循环，别的请求才进得来
			if (questions.length % 16 === 0) await setImmediate();
			questions.push({
				...one,
				near: near(one.word, vectorOf(one)).map((word) => ({
					people: people.get(word) ?? 0,
					word,
				})),
			});
		}
		await collect(client, identity, questions);
		return;
	}
}
