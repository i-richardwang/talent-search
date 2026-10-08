/**
 * 查询理解时模型能用的三个工具：查经历词、查公司名和学校名、提交搜索条件。
 *
 * 前两个工具回答同一个问题：「这样写，搜索会找到什么」。查一个经历词，得到它能
 * 找到多少人、人才库里对应哪些能力词；查一个公司名或学校名，得到它能
 * 匹配到多少人、匹配到人才库里哪些公司或学校。它们和搜索用同一套匹配规则
 * （`search/search.ts`），查到的人数就是写进条件后搜出来的人数。
 *
 * 提交的搜索条件先检查：有没有词表里没有的取值，这一轮新写的经历词是不是
 * 一个人都找不到，名字是不是一个人都匹配不到，是不是什么都没写。有问题就把
 * 问题告诉模型，让它改了再提交。有时问题出在用户明说的要求上，人才库里本来就没有
 * 这样的人，这时模型把同一份条件原样再提交一次，就算通过：没有这样的人也是一个结果。
 *
 * 工具只给模型人数和人才库里的写法，不给人：姓名、工号、任何一段经历都不发给模型，
 * 名单也只从搜索来。发给模型的能力词和公司、学校名，至少有几个人写过（`search.ts`）；
 * 公司内的部门名只给人数。
 *
 * 模型每查一次，就记下一步（`search/trace.ts`），由调用方写进查询记录，界面边跑边画。
 * 同一次理解里查同样几个词或名字，答案不会变：只查一次、只记一步，再问就给同一份答案。
 */
import "@tanstack/react-start/server-only";
import { tool } from "ai";
import { z } from "zod";
import type { Condition } from "#/search/condition";
import {
	isNewClaim,
	type Submission,
	submissionSchema,
	unanswered,
	understood,
	type Vocabulary,
	valuesOutsideVocabulary,
} from "#/search/intent";
import { findNames, findTerms, vocabulary } from "#/search/search";
import type { NameField, TraceStep } from "#/search/trace";

/** 提交搜索条件的工具名。 */
export const SUBMIT = "submit";

/** 一次最多查几个词或名字。 */
const LOOKUP_MAX = 12;

function lookupInputs(list: readonly string[]): string[] {
	return [...new Set(list.map((w) => w.trim()).filter(Boolean))].slice(
		0,
		LOOKUP_MAX,
	);
}

/**
 * 检查一份提交的搜索条件，每个问题一句话；没有问题返回空数组。
 * 条件和说明里每个选项的整张表一起检查：HR 点一下选项，搜的就是那张表。
 */
async function checkSubmission(
	submitted: Submission,
	vocab: Vocabulary,
	base: readonly Condition[],
): Promise<string[]> {
	const result = understood(submitted, vocab, base);
	const failure = unanswered(submitted, result);
	if (failure) return [failure];
	const conditions = [
		...result.spec.conditions,
		...(result.notes?.choices?.others ?? []).flatMap((o) => o.conditions),
	];
	const words = conditions.filter(isNewClaim(base)).flatMap((c) => c.what);
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
		findTerms(words),
		findNames("org", namesOf("org")),
		findNames("school", namesOf("school")),
	]);
	const optionsUnused =
		(submitted.note?.options.length ?? 0) > 0 && !result.notes?.choices;
	return [
		...(optionsUnused
			? [
					"note 的 options 一项都用不上：写了 options 就要写 current，说现在这张表是哪种理解；每一项的表要和现在的表不一样",
				]
			: []),
		...valuesOutsideVocabulary(submitted, vocab),
		...terms.flatMap((t) =>
			t.people === 0
				? [`「${t.text}」在人才库里一个人都找不到，换人才库里的说法`]
				: [],
		),
		...[...orgs, ...schools].flatMap((n) =>
			n.people === 0 ? [`「${n.name}」在人才库里一个人都匹配不到`] : [],
		),
	];
}

/**
 * 一次查询理解用的工具，连同模型最后一次提交的搜索条件。
 * `record` 在模型每查一次时记下一步；词表和上一轮的条件用来检查提交的搜索条件。
 */
export function agentTools({
	vocab,
	base,
	record,
}: {
	vocab: Vocabulary;
	base: readonly Condition[];
	record: (step: TraceStep) => Promise<void>;
}) {
	let last: { submitted: Submission; json: string; problems: string[] } | null =
		null;
	const answered = new Map<string, Promise<unknown>>();
	/** 同样的输入只查一次；并发的两次等同一份答案。 */
	const once = <T>(key: string, look: () => Promise<T>): Promise<T> => {
		const hit = answered.get(key);
		if (hit) return hit as Promise<T>;
		const answer = look();
		answered.set(key, answer);
		return answer;
	};
	const tools = {
		find_terms: tool({
			description:
				"查几个经历词：按搜索的方式各能找到多少人、对应人才库里哪些能力词。",
			inputSchema: z.object({
				texts: z.array(z.string()).describe("要查的词，一次可以几个"),
			}),
			execute: ({ texts }) => {
				const inputs = lookupInputs(texts);
				return once(
					JSON.stringify(["terms", ...[...inputs].sort()]),
					async () => {
						const terms = await findTerms(inputs);
						await record({ at: Date.now(), tool: "find_terms", terms });
						return terms;
					},
				);
			},
		}),
		find_names: tool({
			description:
				"查几个公司名或学校名：各能匹配到多少人、匹配到人才库里哪些公司或学校。名字按包含匹配。",
			inputSchema: z.object({
				field: z
					.enum(["org", "school"])
					.describe("org=公司或部门；school=学校"),
				names: z.array(z.string()).describe("要查的名字，一次可以几个"),
			}),
			execute: ({ field, names }) => {
				const inputs = lookupInputs(names);
				return once(
					JSON.stringify([field, ...[...inputs].sort()]),
					async () => {
						const found = await findNames(field, inputs);
						await record({
							at: Date.now(),
							tool: "find_names",
							field,
							names: found,
						});
						return found;
					},
				);
			},
		}),
		[SUBMIT]: tool({
			description:
				"提交整份新的搜索条件和说明。检查通过，这一轮就结束；没通过会告诉你哪里有问题，改好再提交。问题出在用户明说的要求上时，把同一份条件原样再提交一次。",
			inputSchema: submissionSchema,
			execute: async (submitted) => {
				const json = JSON.stringify(submitted);
				const resubmitted = last !== null && last.json === json;
				const problems = resubmitted
					? []
					: await checkSubmission(submitted, vocab, base);
				last = { submitted, json, problems };
				return problems.length > 0
					? { passed: false, problems }
					: { passed: true };
			},
		}),
	};
	return {
		tools,
		passed: () => last !== null && last.problems.length === 0,
		/** 没通过检查的提交也算。 */
		lastSubmitted: () => last?.submitted,
	};
}

export type AgentTools = ReturnType<typeof agentTools>;

/** 给验收脚本用：不记步骤的一套工具，词表现取。 */
export async function agentToolsWithoutTrace(base: readonly Condition[]) {
	return agentTools({
		vocab: await vocabulary(),
		base,
		record: async () => {},
	});
}
