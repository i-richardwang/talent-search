/**
 * 查询理解的三个工具：查词、查名称、交表。
 *
 * 查词和查名称回答同一个问题——「这样写，搜索会怎么读」：一个经历词按检索口径
 * 能找到多少人、宽不宽、命中了库里哪些能力词；一个公司名或学校名匹配到多少人、
 * 匹配到库里哪些名字。口径就是搜索的口径（`search/search.ts`），查到的和写进条件
 * 后搜到的是一回事。
 *
 * 交表就是这一轮的答案，交上来先检查：词表外的取值、这一轮新写的太宽或一个人都
 * 找不到的经历词、一个人都匹配不到的名字、什么都没写，退回去让模型改。有的问题是
 * 用户要的本来就是库里没有的，模型原样再交一次就收下：没有这样的人也是一个结果。
 * 收下之后由调用方收窄落库（`server/turn.ts`）。
 *
 * 工具只交出数和库里的写法，不交出人：姓名、工号、任何一段经历都不出这台机器，
 * 名单也照旧只从检索来。交出去的词和名字至少有几个人写过（`search.ts`），
 * 部门名只计人数。
 *
 * 查词、查名称每用一次记一步（`search/trace.ts`），由调用方落库，右栏的线程边跑边画。
 */
import "@tanstack/react-start/server-only";
import { tool } from "ai";
import { z } from "zod";
import type { Condition } from "#/search/condition";
import {
	type Intent,
	intentSchema,
	measuredIn,
	offVocabulary,
	unanswered,
	understood,
	type Vocabulary,
} from "#/search/intent";
import { nameReach, termReach, vocabulary } from "#/search/search";
import type { NameField, TraceStep } from "#/search/trace";

type Recorder = (step: TraceStep) => Promise<void>;

/** 交表的工具名：这一轮的答案是它最后一次收到的那张表。 */
export const SUBMIT = "submit";

/** 一次最多查几个词或名字。 */
const ASK_MAX = 12;

function asked(list: readonly string[]): string[] {
	return [...new Set(list.map((w) => w.trim()).filter(Boolean))].slice(
		0,
		ASK_MAX,
	);
}

/**
 * 一份交上来的表有什么要退回去的，一处一句；没有就是空的。
 * 条件表和每一条搜不了的要求附带的替代条件一起查：替代条件点一下就进查询，
 * 同样没有人看过。
 */
async function problemsOf(
	table: Intent,
	vocab: Vocabulary,
	base: readonly Condition[],
): Promise<string[]> {
	const result = understood(table, vocab, base);
	const failure = unanswered(table, result);
	if (failure) return [failure];
	const conditions = [
		...result.spec.conditions,
		...(result.notes?.declined ?? []).flatMap((d) => d.instead),
	];
	const measured = measuredIn(base);
	const words = conditions.filter(measured).flatMap((c) => c.what);
	const namesOf = (field: NameField) =>
		conditions.flatMap((c) =>
			field === "org"
				? c.about === "experience"
					? (c.org ?? [])
					: []
				: c.about === "person" && c.field === "school" && "values" in c
					? c.values
					: [],
		);
	const [terms, orgs, schools] = await Promise.all([
		termReach(words),
		nameReach("org", namesOf("org")),
		nameReach("school", namesOf("school")),
	]);
	return [
		...offVocabulary(table, vocab),
		...terms.flatMap((t) =>
			t.wide
				? [`「${t.text}」能找到 ${t.people} 人，几乎不筛人，换更具体的说法`]
				: t.people === 0
					? [`「${t.text}」在人才库里一个人都找不到，换库里的说法`]
					: [],
		),
		...[...orgs, ...schools].flatMap((n) =>
			n.people === 0 ? [`「${n.name}」在人才库里一个人都匹配不到`] : [],
		),
	];
}

/**
 * 交给模型的工具。`record` 每查一次记一步；词表和当前条件是这一轮的，交表的检查
 * 要它们。
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
	/** 上一次退回的那份表：原样再交一次就收下。 */
	let returned: string | null = null;
	return {
		find_terms: tool({
			description:
				"查几个经历词：按搜索的方式各能找到多少人、会不会太宽、命中了库里哪些能力词。",
			inputSchema: z.object({
				texts: z.array(z.string()).describe("要查的词，一次可以几个"),
			}),
			execute: async ({ texts }) => {
				const terms = await termReach(asked(texts));
				await record({ at: Date.now(), tool: "find_terms", terms });
				return terms;
			},
		}),
		find_names: tool({
			description:
				"查几个公司名或学校名：各能匹配到多少人、匹配到库里哪些名字。名字按包含匹配。",
			inputSchema: z.object({
				field: z
					.enum(["org", "school"])
					.describe("org=公司或部门；school=学校"),
				names: z.array(z.string()).describe("要查的名字，一次可以几个"),
			}),
			execute: async ({ field, names }) => {
				const found = await nameReach(field, asked(names));
				await record({
					at: Date.now(),
					tool: "find_names",
					field,
					names: found,
				});
				return found;
			},
		}),
		[SUBMIT]: tool({
			description:
				"交出整张新的条件表和说明，这一轮就结束。有问题会退回并写明，改完再交；问题出在用户明说的要求上时，原样再交一次。",
			inputSchema: intentSchema,
			execute: async (table) => {
				const key = JSON.stringify(table);
				const problems =
					key === returned ? [] : await problemsOf(table, vocab, base);
				returned = problems.length > 0 ? key : null;
				return problems.length > 0
					? { accepted: false as const, problems }
					: { accepted: true as const };
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
