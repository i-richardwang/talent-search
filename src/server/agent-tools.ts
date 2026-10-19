/**
 * 查询理解时模型能用的三个工具：查经历、查属性、提交搜索条件。
 *
 * 条件里的取值只有两类，一类一个工具，回答的都是「这样写，搜索会找到什么」：
 *
 * - 查经历（`lookup_experience`）：做过什么。按意思匹配，要挑的是粒度。查一个词，
 *   得到它能找到多少人、对应人才库里哪些标准能力词，以及每个能力词在词表里更宽和更细的词。
 * - 查属性（`lookup_attribute`）：职级、学历、招聘渠道、学校档、海外学历、公司档、
 *   入职前公司、公司内部门、学校。按字面匹配，要挑的是写法。有限取值的几维给出全部
 *   取值和人数，和提示词里预先给的是同一份；名字按包含匹配，给出匹配到的人数和
 *   人才库里的写法。
 *
 * 两个查询工具和搜索用同一套匹配规则（`search/search.ts`），查到的人数就是写进条件后
 * 搜出来的人数。
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
import { isVocabKey } from "#/search/dimensions";
import {
	isNewClaim,
	type Submission,
	submissionSchema,
	unanswered,
	understood,
	type Vocabulary,
	valuesOutsideVocabulary,
} from "#/search/intent";
import { lookupExperience, lookupNames, vocabulary } from "#/search/search";
import {
	ATTRIBUTE_FIELDS,
	type Matched,
	type NameField,
	type NameFinding,
	type TraceStep,
} from "#/search/trace";

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
			field === "school"
				? c.about === "person" && c.field === "school" && "values" in c
					? c.values
					: []
				: c.about === "experience"
					? (c[field] ?? [])
					: [],
		);
	const [terms, companies, departments, schools] = await Promise.all([
		lookupExperience(words),
		lookupNames("company", namesOf("company")),
		lookupNames("department", namesOf("department")),
		lookupNames("school", namesOf("school")),
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
		...[...companies, ...departments, ...schools].flatMap((n) =>
			n.people === 0 ? [`「${n.query}」在人才库里一个人都匹配不到`] : [],
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
		lookup_experience: tool({
			description:
				"查几个经历词：按搜索的方式各能找到多少人、对应人才库里哪些标准能力词，以及每个能力词更宽和更细的词。",
			inputSchema: z.object({
				texts: z
					.array(z.string())
					.meta({ description: "要查的词，一次可以几个" }),
			}),
			execute: ({ texts }) => {
				const inputs = lookupInputs(texts);
				return once(
					JSON.stringify(["experience", ...[...inputs].sort()]),
					async () => {
						const terms = await lookupExperience(inputs);
						await record({ at: Date.now(), tool: "lookup_experience", terms });
						return terms;
					},
				);
			},
		}),
		lookup_attribute: tool({
			description:
				"查一种属性在人才库里怎么写、各有多少人。level、education、recruitment、schoolTier、overseas、companyTag 不用给 queries，返回全部取值；company、department、school 按包含匹配 queries 里的每个名字，部门只给人数。",
			inputSchema: z.object({
				field: z.enum(ATTRIBUTE_FIELDS).meta({
					description:
						"level=职级；education=学历；recruitment=招聘渠道；schoolTier=学校档；overseas=海外学历；companyTag=公司档；company=入职前公司；department=公司内部门；school=学校",
				}),
				queries: z.array(z.string()).optional().meta({
					description: "要查的名字，一次可以几个；有限取值的属性不用写",
				}),
			}),
			execute: ({ field, queries }): Promise<Matched[] | NameFinding[]> => {
				if (isVocabKey(field))
					return once(JSON.stringify([field]), async () => {
						const values = [...vocab[field]];
						await record({
							at: Date.now(),
							tool: "lookup_attribute",
							field,
							values,
						});
						return values;
					});
				const inputs = lookupInputs(queries ?? []);
				return once(
					JSON.stringify([field, ...[...inputs].sort()]),
					async () => {
						const found = await lookupNames(field, inputs);
						await record({
							at: Date.now(),
							tool: "lookup_attribute",
							field,
							found,
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
