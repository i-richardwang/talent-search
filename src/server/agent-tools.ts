/**
 * 查询理解在交表之前能用的工具。模型拿它们看一眼库，再决定条件表怎么写：
 * 一个词库里叫什么、多少人写过、会不会太宽；一张表搜出来多少人、分布如何。
 *
 * 工具只交出**数**，不交出人：姓名、工号、任何一段经历都不出这台机器
 * （`server/llm.ts` 的第一条约束），名单也照旧只从检索来——模型看到的是
 * 「42 人」，不是这 42 个人是谁。它据此改的是条件，不是名单。
 *
 * 每用一次记一步（`search/trace.ts`），由调用方落库，右栏的线程边跑边画。
 */
import "@tanstack/react-start/server-only";
import { tool } from "ai";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import type { Condition } from "#/search/condition";
import { conditionItems, understood, type Vocabulary } from "#/search/intent";
import { probeWide, search, vocabulary } from "#/search/search";
import type { TraceStep, WordLookup } from "#/search/trace";
import { peopleUnder, UNDER } from "./skills";

export type Recorder = (step: TraceStep) => Promise<void>;

/** 一次最多查几个词、分布里最多给几档：给模型看的是概况，不是一张表。 */
const WORDS_MAX = 12;
const FACET_TOP = 6;

/** 一个词在能力词表里的标准写法，任一写法都认；词表里没有就是 null。 */
async function canonicalOf(words: string[]): Promise<Map<string, string>> {
	if (words.length === 0) return new Map();
	const { rows } = await db.execute<{ word: string; canonical: string }>(sql`
		select word, canonical from skill_term
		where lower(word) in (${sql.join(
			words.map((w) => sql`${w.toLowerCase()}`),
			sql`, `,
		)})`);
	return new Map(rows.map((r) => [r.word.toLowerCase(), r.canonical]));
}

async function peopleOf(canonicals: string[]): Promise<Map<string, number>> {
	if (canonicals.length === 0) return new Map();
	const { rows } = await db.execute<{ term: string; people: number }>(sql`
		${UNDER}
		select t.term, ${peopleUnder(sql`t.term`)} as people
		from unnest(array[${sql.join(
			canonicals.map((c) => sql`${c}`),
			sql`, `,
		)}]::text[]) as t(term)`);
	return new Map(rows.map((r) => [r.term, r.people]));
}

export async function lookUpWords(words: string[]): Promise<WordLookup[]> {
	const asked = [...new Set(words.map((w) => w.trim()).filter(Boolean))].slice(
		0,
		WORDS_MAX,
	);
	const canonical = await canonicalOf(asked);
	const [people, wide] = await Promise.all([
		peopleOf([...new Set(canonical.values())]),
		probeWide(asked),
	]);
	return asked.map((word) => {
		const term = canonical.get(word.toLowerCase()) ?? null;
		return {
			word,
			canonical: term,
			people: term ? (people.get(term) ?? 0) : 0,
			wide: wide.has(word),
		};
	});
}

/**
 * 试搜一张条件表：多少人、一个都没有时为什么、职级和序列的分布。
 * 条件先过和交表同一道收窄，模型试的就是它交出来会搜的。
 */
export async function tryConditions(
	raw: unknown,
	vocab: Vocabulary,
	base: readonly Condition[],
) {
	const conditions = understood(
		{ conditions: raw, assumed: [], declined: [] },
		vocab,
		base,
	).spec.conditions;
	const outcome = await search({ conditions }, {}, 1);
	const top = <T>(list: { value: T; n: number }[]) =>
		list.slice(0, FACET_TOP).map((f) => ({ value: f.value, people: f.n }));
	return {
		conditions,
		total: outcome.total,
		empty: outcome.empty?.kind ?? null,
		level: top(outcome.facets.level),
		seq: top(outcome.facets.seq),
		companyTag: top(outcome.facets.companyTag),
	};
}

/**
 * 交给模型的工具。`record` 每用一次工具记一步；词表和当前条件是这一轮的，
 * 试搜的收窄要它们。
 */
export function agentTools({
	vocab,
	base,
	record,
}: {
	vocab: Vocabulary;
	base: readonly Condition[];
	record: Recorder;
}) {
	return {
		look_up_words: tool({
			description:
				"查几个词在库里的情况：标准写法是什么、多少人写过、按意思搜会不会太宽。写条件之前先查，用库里的写法。",
			inputSchema: z.object({
				words: z.array(z.string()).describe("要查的词，一次可以几个"),
			}),
			execute: async ({ words }) => {
				const found = await lookUpWords(words);
				await record({ at: Date.now(), tool: "look_up_words", words: found });
				return found;
			},
		}),
		try_conditions: tool({
			description:
				"拿一张条件表试搜：多少人、一个都没有时为什么、职级和序列的分布。太多或太少就改条件再试。",
			inputSchema: z.object({ conditions: conditionItems }),
			execute: async ({ conditions }) => {
				const tried = await tryConditions(conditions, vocab, base);
				await record({
					at: Date.now(),
					tool: "try_conditions",
					conditions: tried.conditions,
					total: tried.total,
					empty: tried.empty,
				});
				return tried;
			},
		}),
	};
}

export type AgentTools = ReturnType<typeof agentTools>;

/** 脚本用：不落库的一套工具，词表现取。 */
export async function detachedTools(base: readonly Condition[]) {
	return agentTools({
		vocab: await vocabulary(),
		base,
		record: async () => {},
	});
}
