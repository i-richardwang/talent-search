/**
 * 查询理解时模型能用的工具：看目录、捞说法、试跑、读经历、提交。找谁由这一个模型定：它写条件
 * 和判据；谁算数由读经历按它写的判据定（`reading.ts`）。
 *
 * - 看目录（`discover`）：数据目录里有什么（`search/catalog.ts`），一列有哪些取值、各多少人，
 *   公司、部门、学校的名字能匹配到多少人和人才库里的写法，记录流覆盖了多少人、哪几期。
 * - 捞说法（`find`）：几条正则各自按字面捞到多少种短说法、多少人，写的人最多的是哪些。模型
 *   据此看人才库里这件事有哪些叫法、哪条正则漏了或捞宽了。搜索还带上词表里同一项的其他写法和
 *   没读过的段的原文，试跑数到的人可能更多。
 * - 试跑（`probe`）：一份完整的条件，每条单独选中多少人、名单上多少人，哪一条写不对、跑不了，
 *   候选人多少、还有多少段经历没确认过。
 * - 读经历（`read`）：把候选人还没确认过的经历读完，回给模型每条读了多少段、多少段算数、还剩
 *   多少段没读。经历的文字不进这段对话：读是另外的请求，按判据逐段判（`reading.ts`）。读是模型
 *   看判据和正则写得准不准的办法，不是它的义务：提交之后，没读完的由这一轮接着读完
 *   （`turn.ts` 的 `performAttempt`），和它在对话里读的是同一个 `Reader`、同一份额度。
 * - 提交（`submit`）：先检查再收下。查的是：形状和白名单、标签里有没有内部用词、这一轮新写或
 *   改过的「做过什么」有没有写判据、新写或改过的条件是不是一个人都找不到、整份是不是宽到名单
 *   出不来、是不是没作答。有问题就告诉模型，让它改了再提交。只是找不到人或太宽、而这正是
 *   用户明说的要求时，模型把同一份条件原样再提交一次就算通过：没有这样的人也是一个结果。别的
 *   问题原样再交也不收。每份条件都在沙箱里真跑一遍，硬错误必须改好才能发布，次数用完也不例外。
 *   没通过的提交记一步。
 *
 * 候选人只从搜索来：读经历判的是搜索找到的段算不算，不添加候选人，也不排序。没确认过的段不算数：
 * 名单上只有确认过的人；一轮读不完时没读到的人不上名单，名单上方写明列到了哪一档职级
 * （`search/empty.ts` 的 `Incomplete`）。
 * 模型每调一次工具记一步，读经历每读一波、每交一批结论各记一步（`search/trace.ts`，只记线程
 * 画得出的那几样），界面边跑边画；通过了的提交不记，结果随后就写进
 * 记录。同一次理解里同样的问题只查一次库。
 */
import "@tanstack/react-start/server-only";
import { tool } from "ai";
import { z } from "zod";
import { internalWordsIn } from "#/lib/internal-words";
import {
	type Submission,
	submissionSchema,
	type Understood,
	unanswered,
	understood,
} from "#/search/intent";
import { contentKey, identityKey, type QueryCondition } from "#/search/query";
import { findPhrases } from "#/search/search";
import type {
	Discovery,
	DiscoveryTrace,
	FoundTrace,
	PatternFinding,
	Probe,
	SubmitIssue,
} from "#/search/trace";
import { discover } from "./discover";
import { type Reader, type RecordStep, type Trial, trial } from "./reading";

/** 提交搜索条件的工具名。 */
export const SUBMIT = "submit" as const;

/** 一次最多查几条正则或名字。 */
const LOOKUP_MAX = 12;

function lookupInputs(list: readonly string[]): string[] {
	return [...new Set(list.map((w) => w.trim()).filter(Boolean))].slice(
		0,
		LOOKUP_MAX,
	);
}

/** 捞说法这一步记下几种说法：线程上一行列得下的。 */
const FOUND_SHOWN = 8;

/** 试跑回给模型的样子。 */
function probeReply(tried: Trial) {
	return {
		conditions: tried.conditions.map(({ condition, people, problem }) => ({
			label: condition.label,
			mode: condition.mode,
			people,
			problem,
		})),
		total: tried.total,
		candidates: tried.candidates,
		unread: tried.unconfirmed.length,
		...(tried.overflow.length > 0 && { tooBroad: tried.overflow }),
	};
}

/** 试跑记进步骤的样子：跑不了的那一条人数记 null，原因是写给模型的，不记。 */
function probeTrace(tried: Trial): Probe {
	return {
		conditions: tried.conditions.map(({ condition, people, problem }) => ({
			label: condition.label,
			mode: condition.mode,
			people: problem === null ? people : null,
		})),
		total: tried.total,
		unread: tried.unconfirmed.length,
	};
}

function foundTrace(finding: PatternFinding): FoundTrace {
	return {
		phrases: finding.phrases,
		top: finding.top.slice(0, FOUND_SHOWN).map((m) => m.name),
	};
}

function discoveryTrace(discovery: Discovery): DiscoveryTrace {
	switch (discovery.kind) {
		case "overview":
			return {
				kind: "overview",
				streams: discovery.streams.map(({ label, first }) => ({
					label,
					first,
				})),
			};
		case "values":
			return {
				kind: "values",
				subject: discovery.subject,
				values: discovery.values.map((v) => v.name),
			};
		case "names":
			return {
				kind: "names",
				subject: discovery.subject,
				found: discovery.found.map((f) => ({
					query: f.query,
					values: f.values.map((v) => v.name),
				})),
			};
		case "problem":
			return { kind: "problem" };
	}
}

/** 对模型说候选人的经历读到哪了：要不要先试读由它定，没读的提交之后都会读完。 */
function nextOf(unread: number, room: number): string {
	if (unread === 0) return "候选人的经历都读过了";
	if (room === 0)
		return "这一轮能读的经历到上限了，其余的候选人名单上方会向 HR 说明，不用为此改条件";
	return "候选人还有经历没读，提交后会继续读；需要检验判据与召回范围时可用 read 试读";
}

/** 提交检查找出的一处问题：回给模型的那句话，和记进步骤给 HR 看的那一类。 */
type Problem = SubmitIssue & { message: string };

/** 一份提交的检查结果，见 `checkSubmission`。 */
type Checked = { result: Understood; hard: Problem[]; soft: Problem[] };

/**
 * 检查一份提交。条件在沙箱里真跑一遍。
 *
 * - `result`：这份提交整理出的条件和说明，没有硬问题时写进记录的就是它。
 * - `hard`：形状不对被丢、标签里有内部用词、这一轮新写或改过的「做过什么」没写判据、
 *   `where` 编不过、正则写不对、执行报错、没作答。写成这样 HR 看到的不是用户要的，或者根本
 *   搜不了，原样再交也不收，一定要改。
 * - `soft`：新写的条件一个人都找不到、宽到名单出不来。人才库里可能本来就没有这样的人，或者
 *   用户要的就这么宽：模型确认是用户的原意，同一份原样再交就收。
 */
async function checkSubmission(
	submitted: Submission,
	base: readonly QueryCondition[],
	rootTurnId: string,
): Promise<Checked> {
	const result = understood(submitted, base);
	const table = result.query.conditions;
	const known = new Set(base.map(identityKey));
	const isNew = (c: QueryCondition) => !known.has(identityKey(c));
	const hard = new Map<string, Problem>();
	const soft = new Map<string, Problem>();
	const add = (to: Map<string, Problem>, problem: Problem) =>
		to.set(problem.message, problem);
	if ((submitted.note?.options.length ?? 0) > 0 && !result.notes?.choices)
		add(hard, {
			kind: "form",
			subject: null,
			message:
				"note 的 options 一项都用不上：写了 options 就要写 current，说现在这份条件是按哪种理解找的；每一项的 label 是 HR 会说的另一句回答",
		});
	const dropped = submitted.conditions.length - table.length;
	if (dropped > 0)
		add(hard, {
			kind: "form",
			subject: null,
			message: `有 ${dropped} 条条件形状不对被丢掉了：每条要有 label、mode、from、where；exclude 只用于 experience；seek、minMonths 只写在 experience 上，seek 的 patterns 和 criterion 至少写一样`,
		});
	for (const c of table) {
		const leaked = internalWordsIn(c.label);
		if (leaked.length > 0)
			add(hard, {
				kind: "wording",
				// 标签里正是 HR 不该看到的词，步骤里不记它（见 `SubmitIssue`）
				subject: null,
				message: `「${c.label}」的 label 原样显示给 HR，不要用「${leaked.join("、")}」这样的词`,
			});
		if (c.seek && !c.seek.criterion && isNew(c))
			add(hard, {
				kind: "form",
				subject: c.label,
				message: `「${c.label}」的 seek 没写 criterion：写清楚什么样的经历算、什么不算`,
			});
	}
	const tried = await trial({ conditions: table }, rootTurnId);
	for (const { condition: c, people, problem } of tried.conditions) {
		if (problem) {
			add(hard, {
				kind: "unrunnable",
				subject: c.label,
				message: `「${c.label}」写不对，原样再提交也不收：${problem}`,
			});
		} else if (people === 0 && isNew(c) && c.mode !== "exclude")
			add(soft, {
				kind: "unfound",
				subject: c.label,
				message: `「${c.label}」一个人都找不到，这不是条件写错。如果只是叫法没对上，用 find 核对后改正则；如果条件已准确表达 HR 的要求，照原样再提交。不要为得到结果拆开同一段经历的要求、删除限定或换成其他要求；哪一项没有人名单上会说，note 里不用说`,
			});
	}
	for (const label of tried.overflow)
		add(soft, {
			kind: "tooBroad",
			subject: label,
			message: `「${label}」找出的经历太多，名单出不来：写得更具体一些`,
		});
	const failure = unanswered(submitted, result);
	// 丢掉的原因上面已经说了（形状不对）；什么都没写的，告诉模型的就是这一句
	if (failure && hard.size === 0)
		add(hard, { kind: "form", subject: null, message: failure });
	return {
		result,
		hard: [...hard.values()],
		soft: [...soft.values()],
	};
}

/**
 * AI 处理一轮用的工具，连同模型最后一次提交的条件。
 * `record` 在模型每调一次工具时记下一步；`reading` 是这一轮的读经历，交出的结论由它记；
 * `base` 是上一轮的条件，用来定 id、沿用停用、判断哪些是新写的；
 * `rootTurnId` 是这一轮所在的找人任务（链头的 id）：读过的结论记在它名下，也只认它名下的。
 */
export function agentTools({
	base,
	record,
	rootTurnId,
	reading,
}: {
	base: readonly QueryCondition[];
	record: RecordStep;
	rootTurnId: string;
	reading: Reader;
}) {
	/** 最后一次检查完的提交：原话、检查结果、过没过（同一份原样再交时只看硬问题）。 */
	let last: {
		submitted: Submission;
		checked: Checked;
		passed: boolean;
	} | null = null;
	const answered = new Map<string, Promise<unknown>>();

	/** 同样的输入只查一次库；查失败的不留着，下一次重新查。 */
	const once = <T>(key: string, look: () => Promise<T>): Promise<T> => {
		const hit = answered.get(key);
		if (hit) return hit as Promise<T>;
		const answer = look();
		answered.set(key, answer);
		answer.catch(() => answered.delete(key));
		return answer;
	};
	const tools = {
		discover: tool({
			description:
				"看数据目录：不写 relation 是总览（各关系多少行、记录流覆盖了多少人和哪几期）；写 relation 和 column 列出这一列的取值和人数；公司、部门、学校这几列按名字包含匹配 match 里的名字。",
			inputSchema: z.object({
				relation: z
					.string()
					.optional()
					.meta({ description: "数据目录里的关系名，比如 person、experience" }),
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
			execute: async (input) => {
				const match = lookupInputs(input.match ?? []);
				const discovery = await once(
					JSON.stringify([
						"discover",
						input.relation,
						input.column,
						input.stream,
						...match.toSorted(),
					]),
					() => discover({ chain: rootTurnId }, { ...input, match }),
				);
				await record({
					at: Date.now(),
					tool: "discover",
					discovery: discoveryTrace(discovery),
				});
				return discovery;
			},
		}),
		find: tool({
			description:
				"按字面捞说法：几条正则（不分大小写）各自在人才库的短说法（任职、岗位名、能力词）里捞到多少种、多少人，写的人最多的是哪些。用它看这件事在人才库里有哪些叫法、正则有没有漏掉的或捞宽了的。这里只列正则自己捞到的短说法；搜索时还会带上词表里同一项的其他写法和没读过的经历的简历原文，所以 probe 数到的人可能更多。",
			inputSchema: z.object({
				patterns: z
					.array(z.string())
					.meta({ description: "要试的正则，一次可以几条" }),
			}),
			execute: async ({ patterns }) => {
				const inputs = lookupInputs(patterns);
				const found = await once(
					JSON.stringify(["find", ...inputs.toSorted()]),
					() => findPhrases({ chain: rootTurnId }, inputs),
				);
				await record({
					at: Date.now(),
					tool: "find",
					found: found.map(foundTrace),
				});
				return found;
			},
		}),
		probe: tool({
			description:
				"试跑一份完整的条件：每条单独选中多少人（people；写了 seek 的是字面对得上的人，含还没读过的；exclude 是它最多会拦下的人）、名单上多少人（total），哪一条写不对或跑不了，候选人有多少（candidates）、他们还有多少段经历没读过（unread）。没读过的经历不算数，那些人还不在名单上。",
			inputSchema: z.object({ conditions: submissionSchema.shape.conditions }),
			execute: async ({ conditions }) => {
				const { query } = understood({ conditions }, base);
				// 标签也在回答里：只改了标签的同一份条件要回新的标签
				const key = query.conditions.map((c) => [c.label, contentKey(c)]);
				const tried = await once(
					JSON.stringify(["probe", reading.concluded(), key]),
					() => trial(query, rootTurnId),
				);
				await record({
					at: Date.now(),
					tool: "probe",
					probe: probeTrace(tried),
				});
				return {
					...probeReply(tried),
					todo: nextOf(tried.unconfirmed.length, reading.room()),
				};
			},
		}),
		read: tool({
			description:
				"把候选人还没读过的经历读完：这份条件找出的人，在写了 criterion 的条件上被正则捞到（没写正则的条件是 where 圈出的每一段）、还没读过的那些段，按所属条件的 criterion 逐段判断算不算，职级高的人在前。回给你每条这一次读了多少段（read）、多少段算数（fits），候选人还剩多少段没读（left）。读的时候只看得到那一条的 label、criterion 和那一段经历。",
			inputSchema: z.object({ conditions: submissionSchema.shape.conditions }),
			execute: async ({ conditions }, { abortSignal }) => {
				const { query } = understood({ conditions }, base);
				const done = await reading.read(query, abortSignal);
				if (done.kind === "unlisted") {
					await record({ at: Date.now(), tool: "read", unlisted: true });
					return {
						...probeReply(done.tried),
						todo: "这份条件跑不出名单，没有经历可读：先把有问题的那一条改好",
					};
				}
				// 一段都没读：都读过了，或者到了这一轮的上限
				if (done.conditions.length === 0)
					await record({
						at: Date.now(),
						tool: "read",
						segments: 0,
						left: done.left,
					});
				return {
					conditions: done.conditions,
					left: done.left,
					todo: nextOf(done.left, reading.room()),
				};
			},
		}),
		[SUBMIT]: tool({
			description:
				"提交整份新的条件和说明。检查通过，理解就结束，候选人还没读的经历接着读完；没通过会告诉你哪里有问题，改好再提交。只是找不到人或太宽、而这正是用户明说的要求时，把同一份条件原样再提交一次；写不对、跑不了的原样再交也不收。",
			inputSchema: submissionSchema,
			execute: async (submitted) => {
				const resubmitted =
					last !== null &&
					JSON.stringify(last.submitted) === JSON.stringify(submitted);
				const checked = await checkSubmission(submitted, base, rootTurnId);
				const problems = resubmitted
					? checked.hard
					: [...checked.hard, ...checked.soft];
				last = {
					submitted,
					checked,
					passed: problems.length === 0,
				};
				if (last.passed) return { passed: true };
				// 没通过的提交也记一步：HR 看得到哪一条、哪一类问题，回给模型的话不记
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
		base,
		tools,
		passed: () => last?.passed ?? false,
		/**
		 * 最后一次提交能写进记录的结果，或者它还有的硬问题；还没提交过为 null。次数用完时
		 * 只有找不到人、找出的太多这两类问题可以带着交。
		 */
		answer: (): { result: Understood } | { error: string } | null => {
			if (!last) return null;
			const { result, hard } = last.checked;
			return hard.length > 0
				? { error: hard.map((problem) => problem.message).join("；") }
				: { result };
		},
	};
}

export type AgentTools = ReturnType<typeof agentTools>;
