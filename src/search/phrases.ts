/**
 * 一条「做过什么」（`query.ts` 的 `Seek`）的正则落到说法上：在全部说法的文字上按字面捞，不分
 * 大小写。词表里同一项的几种写法是同一件事，捞到其中一种，整项的写法都算捞到。更宽、更细的词
 * 不跟着带：细的算不算，由它自己被没被捞到决定。
 *
 * 捞到只说明字面对得上。写了判据的条件，哪一段经历真的算，由查询理解读过那一段之后定
 * （`server/judged.ts`），在物化命中时接上（`execute.ts`）。
 */

import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { db } from "#/db";
import { type DbExecutor, withCorpusSnapshot } from "#/db/snapshot";
import type { Seek } from "./query";

/** 一条「做过什么」捞到的说法，或者它为什么找不了。 */
export type MatchedPhrases = { phraseIds: number[] } | { problem: string };

/** 一条带正则的语句最多跑多久。正则是模型或请求写的，写得再怪也不能拖住连接。 */
const MATCH_TIMEOUT = "10s";

/** 数据库对一条正则的意见：写不对，或者跑得太久；别的错误为 null。 */
function regexProblem(error: unknown): string | null {
	const cause = (error as { cause?: unknown }).cause ?? error;
	const pg = cause as { code?: unknown; message?: unknown };
	if (pg.code === "2201B")
		return `写不对：${String(pg.message).split("\n")[0]}`;
	if (pg.code === "57014") return "跑得太久，写得简单一些";
	return null;
}

/**
 * 在快照里跑一条带正则的语句，限时。语句在自己的保存点里：正则写不对或跑得太久时给出原因，
 * 不中止取数的事务。
 */
export async function matching<T>(
	store: DbExecutor,
	run: () => Promise<T>,
): Promise<{ value: T } | { problem: string }> {
	await store.execute(sql.raw("savepoint matching"));
	try {
		await store.execute(
			sql.raw(`set local statement_timeout = '${MATCH_TIMEOUT}'`),
		);
		return { value: await run() };
	} catch (error) {
		const problem = regexProblem(error);
		if (problem === null) throw error;
		return { problem: `正则${problem}` };
	} finally {
		await store.execute(sql.raw("rollback to savepoint matching"));
		await store.execute(sql.raw("release savepoint matching"));
	}
}

async function matchPhrases(
	store: DbExecutor,
	seek: Seek,
): Promise<MatchedPhrases> {
	if (seek.patterns.length === 0) return { phraseIds: [] };
	const result = await matching(store, () =>
		store.execute<{ id: number }>(sql`
			with caught as (
				select p.text from phrase p
				where p.text ~* any(${sql.param(seek.patterns)}::text[])
			),
			same as (
				select t.word from term t
				where t.canonical in (
					select g.canonical from caught c join term g on g.word = c.text)
			)
			select p.id from phrase p
			where p.text in (select text from caught)
				or p.text in (select word from same)`),
	);
	return "problem" in result
		? result
		: { phraseIds: result.value.rows.map((row) => row.id) };
}

/** 一条「做过什么」里哪条正则写不对。在进快照前查，原因里说得出是哪一条。 */
async function patternProblem(seek: Seek): Promise<string | null> {
	for (const pattern of seek.patterns)
		try {
			await db.execute(sql`select '' ~* ${pattern}`);
		} catch (error) {
			const problem = regexProblem(error);
			if (problem === null) throw error;
			return `正则「${pattern}」${problem}`;
		}
	return null;
}

/** 在同一语料快照里给出每条「做过什么」捞到的说法，再交给 `use` 取数。结果按 `seeks` 的下标。 */
export async function withMatchedPhrases<T>(
	seeks: readonly Seek[],
	use: (store: DbExecutor, matched: MatchedPhrases[]) => Promise<T>,
): Promise<T> {
	const problems = await Promise.all(seeks.map(patternProblem));
	return withCorpusSnapshot(async (store) => {
		const matched: MatchedPhrases[] = [];
		for (const [i, seek] of seeks.entries()) {
			const problem = problems[i];
			matched.push(problem ? { problem } : await matchPhrases(store, seek));
		}
		return use(store, matched);
	});
}
