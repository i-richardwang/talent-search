/**
 * 查询理解时模型能用的四个工具：看目录、查经历词、试跑、提交。
 *
 * - 看目录（`discover`）：数据目录里有什么（`search/catalog.ts`），一列有哪些取值、各多少人，
 *   公司、部门、学校的名字能匹配到多少人和人才库里的写法，记录流覆盖了多少人、哪几期。
 * - 查经历词（`lookup_experience`）：做过什么。按意思匹配，要挑的是粒度。查一个词，得到它能
 *   找到多少人、对应人才库里哪些标准能力词，以及每个能力词在词表里更宽和更细的词。
 * - 试跑（`probe`）：一份完整的条件，每条单独有多少人、整份多少人，哪一条写不对、跑不了。
 * - 提交（`submit`）：先检查再收下。查的是：形状和白名单、标签里有没有内部用词、这一轮新写或
 *   改过的条件是不是一个人都找不到、新写的语义词是不是一个人都找不到、整份是不是宽到名单出不来。
 *   有问题就告诉模型，让它改了再提交。只是找不到人或太宽、而这正是用户明说的要求时，模型把
 *   同一份条件原样再提交一次就算通过：没有这样的人也是一个结果。形状、标签、写不对和跑不了的
 *   问题原样再交也不收。每份条件都在沙箱里真跑一遍，跑通的那份是录取的：写进记录的只有它，
 *   次数用完时最后一次没通过也一样。没通过的提交记一步。
 *
 * 工具只给模型人数和人才库里的写法，不给人：姓名、工号、任何一段经历都不发给模型，名单也只从
 * 搜索来。发给模型的能力词和公司、学校名，至少有几个人写过（`search.ts`）；公司内的部门名只给人数。
 * 查询记录里每查一次记一步（`search/trace.ts`），界面边跑边画。同一次理解里同样的问题只查一次。
 */
import "@tanstack/react-start/server-only";
import { tool } from "ai";
import { z } from "zod";
import { internalWordsIn } from "#/lib/internal-words";
import { CATALOG } from "#/search/catalog";
import { probe as probeQuery } from "#/search/execute";
import {
	type Submission,
	submissionSchema,
	type Understood,
	unanswered,
	understood,
} from "#/search/intent";
import {
	contentKey,
	identityKey,
	type Query,
	type QueryCondition,
	termValues,
} from "#/search/query";
import { lookupExperience } from "#/search/search";
import type { Probe, SubmitIssue, TraceStep } from "#/search/trace";
import { discover } from "./discover";

/** 提交搜索条件的工具名。 */
export const SUBMIT = "submit" as const;

/** 一次最多查几个词或名字。 */
const LOOKUP_MAX = 12;

function lookupInputs(list: readonly string[]): string[] {
	return [...new Set(list.map((w) => w.trim()).filter(Boolean))].slice(
		0,
		LOOKUP_MAX,
	);
}

/** 试跑一份查询，给模型的和记进步骤的是同一份：标签、强度、人数、问题。 */
async function trial(query: Query): Promise<Probe & { overflow: string[] }> {
	const result = await probeQuery(query);
	const byId = new Map(result.conditions.map((c) => [c.id, c]));
	return {
		conditions: query.conditions
			.filter((c) => !c.off)
			.map((c) => ({
				label: c.label,
				mode: c.mode,
				people: byId.get(c.id)?.people ?? null,
				problem: byId.get(c.id)?.problem ?? null,
			})),
		total: result.total,
		overflow: query.conditions
			.filter((c) => result.overflow.includes(c.id))
			.map((c) => c.label),
	};
}

/** 提交检查找出的一处问题：回给模型的那句话，和记进步骤给 HR 看的那一类。 */
type Problem = SubmitIssue & { message: string };

/**
 * 检查一份提交。条件和说明里每个选项的整份条件一起检查，每份都在沙箱里真跑一遍：HR 点一下
 * 选项，搜的就是那一份。
 *
 * - `admitted`：跑通了的那份，写进记录的就是它。编不过白名单或执行报错的条件按内容
 *   （`contentKey`）丢掉，和 `understood` 丢形状不合规的条件同一条规则，选项的表也一样。
 * - `hard`：没作答、形状不对被丢、标签里有内部用词、`where` 编不过或执行报错。写成这样
 *   HR 看到的不是用户要的，或者根本搜不了，原样再交也不收，一定要改。
 * - `soft`：新写的条件或语义词一个人都找不到、宽到名单出不来。人才库里可能本来就没有这样的人，
 *   或者用户要的就这么宽：模型确认是用户的原意，同一份原样再交就收。
 */
async function checkSubmission(
	submitted: Submission,
	base: readonly QueryCondition[],
): Promise<{ admitted: Understood; hard: Problem[]; soft: Problem[] }> {
	const result = understood(submitted, base);
	const failure = unanswered(submitted, result);
	if (failure)
		return {
			admitted: result,
			hard: [{ kind: "form", subject: null, message: failure }],
			soft: [],
		};
	const tables = [
		result.query.conditions,
		...(result.notes?.choices?.others ?? []).map((o) => o.conditions),
	];
	const known = new Set(base.map(identityKey));
	const isNew = (c: QueryCondition) => !known.has(identityKey(c));
	const hard = new Map<string, Problem>();
	const soft = new Map<string, Problem>();
	const add = (to: Map<string, Problem>, problem: Problem) =>
		to.set(problem.message, problem);
	const optionsUnused =
		(submitted.note?.options.length ?? 0) > 0 && !result.notes?.choices;
	if (optionsUnused)
		add(hard, {
			kind: "form",
			subject: null,
			message:
				"note 的 options 一项都用不上：写了 options 就要写 current，说现在这份条件是哪种理解；每一项的条件要和现在的不一样",
		});
	const dropped = submitted.conditions.length - result.query.conditions.length;
	if (dropped > 0)
		add(hard, {
			kind: "form",
			subject: null,
			message: `有 ${dropped} 条条件形状不对被丢掉了：每条要有 label、mode、from、where；exclude 只用于 experience；terms、minMonths 只写在 experience 上`,
		});
	for (const table of tables)
		for (const c of table) {
			const leaked = internalWordsIn(c.label);
			if (leaked.length > 0)
				add(hard, {
					kind: "wording",
					// 标签里正是 HR 不该看到的词，步骤里不记它（见 `SubmitIssue`）
					subject: null,
					message: `「${c.label}」的 label 原样显示给 HR，不要用「${leaked.join("、")}」这样的词`,
				});
		}
	const words = [
		...new Set(
			tables.flatMap((t) =>
				t.filter((c) => isNew(c) && c.mode !== "exclude").flatMap(termValues),
			),
		),
	];
	const [terms, ...trials] = await Promise.all([
		lookupExperience(words),
		...tables.map((conditions) => trial({ conditions })),
	]);
	const unfound = new Set(
		terms.filter((t) => t.people === 0).map((t) => t.text),
	);
	for (const word of unfound)
		add(soft, {
			kind: "unfound",
			subject: word,
			message: `「${word}」在人才库里一个人都找不到：是你补的就换人才库里的说法；是用户点名的，照原样再提交`,
		});
	const failed = new Set<string>();
	for (const [n, table] of tables.entries()) {
		const tried = trials[n];
		if (!tried) continue;
		const active = table.filter((c) => !c.off);
		for (const [i, c] of active.entries()) {
			const one = tried.conditions[i];
			if (!one) continue;
			if (one.problem) {
				failed.add(contentKey(c));
				add(hard, {
					kind: "unrunnable",
					subject: c.label,
					message: `「${c.label}」写不对，原样再提交也不收：${one.problem}`,
				});
			}
			// 找不到人的词已经单独说了，这一条不再重复
			else if (
				one.people === 0 &&
				isNew(c) &&
				c.mode !== "exclude" &&
				!termValues(c).some((w) => unfound.has(w))
			)
				add(soft, {
					kind: "unfound",
					subject: c.label,
					message: `「${c.label}」在人才库里一个人都找不到：是你补的就改；是用户点名的，照原样再提交，在 note 里说一句`,
				});
		}
		for (const label of tried.overflow)
			add(soft, {
				kind: "tooBroad",
				subject: label,
				message: `「${label}」找出的经历太多，名单出不来：写得更具体一些`,
			});
	}
	return {
		admitted:
			failed.size > 0
				? understood(submitted, base, (d) => !failed.has(contentKey(d)))
				: result,
		hard: [...hard.values()],
		soft: [...soft.values()],
	};
}

/**
 * 一次查询理解用的工具，连同模型最后一次提交的条件。
 * `record` 在模型每查一次时记下一步；上一轮的条件用来定 id、沿用停用、判断哪些是新写的。
 */
export function agentTools({
	base,
	record,
}: {
	base: readonly QueryCondition[];
	record: (step: TraceStep) => Promise<void>;
}) {
	/** 最后一次检查完的提交：原话、录取的那份、这次没过的问题。 */
	let last: {
		submitted: Submission;
		json: string;
		admitted: Understood;
		problems: Problem[];
	} | null = null;
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
		discover: tool({
			description:
				"看数据目录：不写 relation 是总览（各关系多少行、记录流覆盖了多少人和哪几期）；写 relation 和 column 列出这一列的取值和人数；公司、部门、学校这几列按名字包含匹配 match 里的名字。",
			inputSchema: z.object({
				relation: z
					.enum(CATALOG.map((r) => r.name) as [string, ...string[]])
					.optional(),
				column: z.string().optional(),
				stream: z
					.string()
					.optional()
					.meta({ description: "看 rating 或 status 的 value 时写是哪一条流" }),
				match: z
					.array(z.string())
					.optional()
					.meta({ description: "按名字找时要找的名字，一次可以几个" }),
			}),
			execute: (input) => {
				const match = lookupInputs(input.match ?? []);
				const ask = { ...input, match };
				return once(
					JSON.stringify([
						"discover",
						ask.relation,
						ask.column,
						ask.stream,
						...[...match].sort(),
					]),
					async () => {
						const discovery = await discover(ask);
						await record({ at: Date.now(), tool: "discover", discovery });
						return discovery;
					},
				);
			},
		}),
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
		probe: tool({
			description:
				"试跑一份完整的条件：每条单独能找到多少人、整份能找到多少人，哪一条写不对或跑不了。只给人数，不给人。",
			inputSchema: z.object({ conditions: submissionSchema.shape.conditions }),
			execute: ({ conditions }) => {
				const { query } = understood({ conditions }, base);
				const json = JSON.stringify(query.conditions.map(contentKey));
				return once(JSON.stringify(["probe", json]), async () => {
					const { overflow, ...probe } = await trial(query);
					await record({ at: Date.now(), tool: "probe", probe });
					return overflow.length > 0 ? { ...probe, tooBroad: overflow } : probe;
				});
			},
		}),
		[SUBMIT]: tool({
			description:
				"提交整份新的条件和说明。检查通过，这一轮就结束；没通过会告诉你哪里有问题，改好再提交。只是找不到人或太宽、而这正是用户明说的要求时，把同一份条件原样再提交一次；写不对、跑不了的原样再交也不收。",
			inputSchema: submissionSchema,
			execute: async (submitted) => {
				const json = JSON.stringify(submitted);
				const resubmitted = last !== null && last.json === json;
				const { admitted, hard, soft } = await checkSubmission(submitted, base);
				const problems = resubmitted ? hard : [...hard, ...soft];
				last = { submitted, json, admitted, problems };
				if (problems.length === 0) return { passed: true };
				// 没通过的提交也记一步：HR 看得到哪里要改，这一次理解也留下了还在进行的痕迹
				await record({
					at: Date.now(),
					tool: SUBMIT,
					issues: problems.map(({ kind, subject }) => ({ kind, subject })),
				});
				return { passed: false, problems: problems.map((p) => p.message) };
			},
		}),
	};
	return {
		tools,
		passed: () => last !== null && last.problems.length === 0,
		/**
		 * 最后一次检查完的提交和它录取的那份。次数用完时最后一次没通过也用它：录取的那份里
		 * 没有跑不了的条件，写进记录的就是它。
		 */
		answer: () =>
			last && { submitted: last.submitted, admitted: last.admitted },
	};
}

export type AgentTools = ReturnType<typeof agentTools>;

/** 给验收脚本用：不记步骤的一套工具。 */
export function agentToolsWithoutTrace(base: readonly QueryCondition[]) {
	return agentTools({ base, record: async () => {} });
}
