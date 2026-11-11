/**
 * 查询理解时模型能用的工具：看目录、捞说法、试跑、读经历、下结论、提交。找谁、谁算数都是
 * 这一个模型做的，没有另一道判断。
 *
 * - 看目录（`discover`）：数据目录里有什么（`search/catalog.ts`），一列有哪些取值、各多少人，
 *   公司、部门、学校的名字能匹配到多少人和人才库里的写法，记录流覆盖了多少人、哪几期。
 * - 捞说法（`find`）：几条正则各自按字面捞到多少种短说法、多少人，写的人最多的是哪些。模型
 *   据此看人才库里这件事有哪些叫法、哪条正则漏了或捞宽了。搜索还带上词表里同一项的其他写法和
 *   没读过的段的原文，试跑数到的人可能更多。
 * - 试跑（`probe`）：一份完整的条件，每条单独选中多少人、名单上多少人，哪一条写不对、跑不了，
 *   候选人多少、还有多少段经历没确认过。
 * - 读经历（`read`）：把候选人还没确认过的经历取一批来：在哪家公司或哪个部门、序列、岗位、
 *   技能、简历原文。职级高的人在前，一轮最多读 `READ_MAX` 段：人在等，读到这里为止。
 * - 下结论（`judge`）：这一批里哪几段符合，只交符合的编号；没交的按不算，一起存下来
 *   （`server/judged.ts`），并带回下一批。只收模型眼前那一批的结论：上一步给出的那一批。
 *   中间做了别的、或者交的编号不在这一批里，这一批的结论不记，重新取、重新交。
 * - 提交（`submit`）：先检查再收下。查的是：形状和白名单、标签里有没有内部用词、这一轮新写或
 *   改过的「做过什么」有没有写判据、新写或改过的条件是不是一个人都找不到、这一轮读得到的经历
 *   是不是都确认过了、读过之后判据有没有改字、整份是不是宽到名单出不来、是不是没作答。有问题
 *   就告诉模型，让它改了再提交。只是找不到人或太宽、而这正是用户明说的要求时，模型把同一份
 *   条件原样再提交一次就算通过：没有这样的人也是一个结果。别的问题原样再交也不收。每份条件
 *   都在沙箱里真跑一遍，跑通的那份是录取的：写进记录的只有它，次数用完时最后一次没通过也一样。
 *   没通过的提交记一步。
 *
 * HR 直接改条件之后，条件已经定了，只剩把新进范围的候选人确认完：用的是同一套读经历和下结论
 * （`begin` 取第一批，之后每交一次结论带回下一批）。
 *
 * 候选人只从搜索来：模型判的是搜索找到的段算不算，不添加候选人，也不排序。没确认过的段不算数：
 * 名单上只有模型确认过的人；一轮读不完时没读到的人不上名单，名单上方写明覆盖到了哪一档职级
 * （`search/empty.ts` 的 `Incomplete`）。
 * 模型每调一次工具记一步（`search/trace.ts`，只记线程画得出的那几样），界面边跑边画，也是
 * 这一次处理还在的凭据；通过了的提交不记，结果随后就写进记录。同一次理解里同样的问题只查一次库。
 */
import "@tanstack/react-start/server-only";
import { tool } from "ai";
import { z } from "zod";
import { internalWordsIn } from "#/lib/internal-words";
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
} from "#/search/query";
import { findPhrases } from "#/search/search";
import type {
	Discovery,
	DiscoveryTrace,
	FoundTrace,
	PatternFinding,
	Probe,
	SubmitIssue,
	TraceStep,
} from "#/search/trace";
import { discover } from "./discover";
import { segmentTexts, type Verdict } from "./judged";

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

/** 结果里带着一批经历的两个工具：交过结论的那几批不用再发给模型（`llm.ts`）。 */
export const BATCH_TOOLS: readonly string[] = ["read", "judge"];

/** 一次给模型读几段经历。 */
export const READ_BATCH = 160;

/** 一轮最多给模型读几段：人在等，读到这里为止。 */
export const READ_MAX = 1280;

/** 捞说法这一步记下几种说法：线程上一行列得下的。 */
const FOUND_SHOWN = 8;

/**
 * 试跑一份查询：每条启用的条件单独选中多少人、写不对的原因，名单和候选人的人数，太宽的那几条，
 * 连同候选人还没确认过的段。
 */
async function trial(query: Query, rootTurnId: string) {
	const result = await probeQuery(query, rootTurnId);
	const byId = new Map(query.conditions.map((c) => [c.id, c]));
	return {
		conditions: result.conditions.flatMap(({ id, people, problem }) => {
			const condition = byId.get(id);
			return condition && !condition.off
				? [{ condition, people, problem }]
				: [];
		}),
		total: result.total,
		candidates: result.candidates,
		overflow: query.conditions
			.filter((c) => result.overflow.includes(c.id))
			.map((c) => c.label),
		unconfirmed: result.unconfirmed,
	};
}

type Trial = Awaited<ReturnType<typeof trial>>;

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
		candidates: tried.candidates,
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

/** 对模型说的下一步：候选人还有 `unread` 段经历没看，这一轮还能读 `room` 段。 */
function nextOf(unread: number, room: number): string {
	if (unread === 0) return "候选人的经历都看过了，可以提交";
	if (room <= 0)
		return "这一轮能看的经历看完了，其余的候选人名单上方会向 HR 说明：直接提交";
	return "候选人还有经历没看过，没看过的不上名单：用 read 取来看";
}

/** 提交检查找出的一处问题：回给模型的那句话，和记进步骤给 HR 看的那一类。 */
type Problem = SubmitIssue & { message: string };

/**
 * 检查一份提交。条件在沙箱里真跑一遍。
 *
 * - `admitted`：跑通了的那份，写进记录的就是它。编不过白名单或执行报错的条件按内容
 *   （`contentKey`）丢掉，和 `understood` 丢形状不合规的条件同一条规则。
 * - `unanswered`：录取的那份算不算作答（`search/intent.ts` 的 `unanswered`），不算时是原因。
 * - `hard`：形状不对被丢、标签里有内部用词、这一轮新写或改过的「做过什么」没写判据、
 *   `where` 编不过、正则写不对、执行报错、这一轮还读得到的经历没确认（`room` 是还能读几段）、
 *   读过之后改了判据的字（`given` 是这一轮给模型读过的判据：其中有的不在提交里了，提交里又多出
 *   一条哪一轮都没读过的判据。结论按判据的文字存，改一个字读过的就都用不上）、没作答。写成这样
 *   HR 看到的不是用户要的，或者根本搜不了，原样再交也不收，一定要改。
 * - `soft`：新写的条件一个人都找不到、宽到名单出不来。人才库里可能本来就没有这样的人，或者
 *   用户要的就这么宽：模型确认是用户的原意，同一份原样再交就收。
 */
async function checkSubmission(
	submitted: Submission,
	base: readonly QueryCondition[],
	room: number,
	given: ReadonlySet<string>,
	rootTurnId: string,
): Promise<{
	admitted: Understood;
	unanswered: string | null;
	hard: Problem[];
	soft: Problem[];
}> {
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
	const failed = new Set<string>();
	for (const { condition: c, people, problem } of tried.conditions) {
		if (problem) {
			failed.add(contentKey(c));
			add(hard, {
				kind: "unrunnable",
				subject: c.label,
				message: `「${c.label}」写不对，原样再提交也不收：${problem}`,
			});
		} else if (people === 0 && isNew(c) && c.mode !== "exclude")
			add(soft, {
				kind: "unfound",
				subject: c.label,
				message: `「${c.label}」在人才库里一个人都找不到：字面对不上，或者对得上的经历你都判了不符合。先用 find 看看人才库里这件事怎么叫，改正则；确实没有这样的人、而用户点名要，照原样再提交，在 note 里说一句`,
			});
	}
	for (const label of tried.overflow)
		add(soft, {
			kind: "tooBroad",
			subject: label,
			message: `「${label}」找出的经历太多，名单出不来：写得更具体一些`,
		});
	if (tried.unconfirmed.length > 0) {
		const active = tried.conditions.map(({ condition }) => condition);
		const criteriaOf = (list: readonly QueryCondition[]) =>
			list.flatMap((c) => (c.seek?.criterion ? [c.seek.criterion] : []));
		const kept = new Set(criteriaOf(active));
		const lost = [...given].filter((criterion) => !kept.has(criterion));
		const before = new Set(criteriaOf(base));
		const rewritten =
			lost.length > 0
				? active.filter(
						(c) =>
							c.seek?.criterion &&
							!given.has(c.seek.criterion) &&
							!before.has(c.seek.criterion),
					)
				: [];
		for (const c of rewritten)
			add(hard, {
				kind: "unread",
				subject: c.label,
				message: `「${c.label}」的 criterion 和你读经历时写的不一样，读过的结论用不上：改回读的时候那一份，一个字都不要改——${lost.map((criterion) => `「${criterion}」`).join("；")}${room > 0 ? "。确实要换判据，就用 read 重新读" : ""}`,
			});
		if (rewritten.length === 0 && room > 0)
			add(hard, {
				kind: "unread",
				subject: null,
				message:
					"候选人还有经历没看过，没看过的不上名单：用 read 取来看，用 judge 交上符合的段，看完再提交",
			});
	}
	const admitted =
		failed.size > 0
			? understood(submitted, base, (d) => !failed.has(contentKey(d)))
			: result;
	const failure = unanswered(submitted, admitted);
	// 丢空了的原因上面已经说了（形状不对、跑不了）；什么都没写的，告诉模型的就是这一句
	if (failure && hard.size === 0)
		add(hard, { kind: "form", subject: null, message: failure });
	return {
		admitted,
		unanswered: failure,
		hard: [...hard.values()],
		soft: [...soft.values()],
	};
}

/**
 * 给模型读的一批经历：出自哪份条件，编号 → 哪条判据下的哪一段，连同写给模型看的那几组文字。
 */
type Batch = {
	/**
	 * 交完这一批按它取下一批。每次重新找候选：已出局的人不再读，必须和排除都确认完才轮到加分。
	 */
	query: Query;
	segments: Map<number, { criterion: string; content: string }>;
	groups: {
		label: string;
		criterion: string;
		segments: { n: number; text: string }[];
	}[];
};

/**
 * 取经历的结果：取到一批；没有可取的（候选人的都确认过了，或者到了这一轮的上限）；或者这份
 * 条件出不了名单（有一条跑不了，或者找出的太多），没有经历可读。
 */
type Delivery =
	| { kind: "batch"; batch: Batch; left: number }
	| { kind: "none"; left: number }
	| { kind: "unlisted"; tried: Trial };

/** 记一步，连同这一步存下的结论（没有结论的步给空数组）：调用方把两样一起写入。 */
export type RecordStep = (
	step: TraceStep,
	verdicts: readonly Verdict[],
) => Promise<void>;

const JUDGE_TODO = "逐段看完，用 judge 交上这一批里符合的段的编号";

/**
 * AI 处理一轮用的工具，连同模型最后一次提交的条件。
 * `record` 在模型每调一次工具时记下一步，下结论时同时交出这一批结论；
 * `base` 是上一轮的条件，用来定 id、沿用停用、判断哪些是新写的；
 * `rootTurnId` 是这一轮所在的找人任务（链头的 id）：读过的结论记在它名下，也只认它名下的。
 */
export function agentTools({
	base,
	record,
	rootTurnId,
}: {
	base: readonly QueryCondition[];
	record: RecordStep;
	rootTurnId: string;
}) {
	/** 最后一次检查完的提交：原话、录取的那份、算不算作答、过没过。 */
	let last: {
		submitted: Submission;
		admitted: Understood;
		unanswered: string | null;
		passed: boolean;
	} | null = null;
	const answered = new Map<string, Promise<unknown>>();
	/**
	 * 模型此刻看得到、可以交结论的那一批：上一步的工具结果里给出的。更早给出的已经不在它眼前
	 * （`llm.ts` 把之前的批次换成一句话），不收它们的结论——没交的按不算存，存错了没有机会重读。
	 */
	let hand: Batch | null = null;
	/** 这一步刚给出的一批：模型走下一步时才看得到（`advance`）。 */
	let fresh: Batch | null = null;
	/** 最近一次取经历没有可取的了，或者条件出不了名单：读到头了。 */
	let ended = false;
	/** 这一轮给模型读过的判据。 */
	const given = new Set<string>();
	/** 这一轮已经存下结论的段数。试跑的结果随它变。 */
	let concluded = 0;
	/** 段的编号，一轮之内不重复。 */
	let numbered = 0;
	const room = () => READ_MAX - concluded;
	const log = (step: TraceStep) => record(step, []);

	/** 取这份条件的下一批经历，写成给模型读的样子。 */
	const deliver = async (query: Query): Promise<Delivery> => {
		fresh = null;
		ended = false;
		const tried = await trial(query, rootTurnId);
		if (tried.total === null) {
			ended = true;
			return { kind: "unlisted", tried };
		}
		const left = tried.unconfirmed.length;
		const taken = tried.unconfirmed.slice(
			0,
			Math.max(0, Math.min(READ_BATCH, room())),
		);
		if (taken.length === 0) {
			ended = true;
			return { kind: "none", left };
		}
		const texts = await segmentTexts([
			...new Set(taken.map((u) => u.experienceId)),
		]);
		const batch: Batch = { query, segments: new Map(), groups: [] };
		const groups = new Map<string, Batch["groups"][number]>();
		for (const { condition, experienceId } of taken) {
			const criterion = condition.seek?.criterion;
			const segment = texts.get(experienceId);
			// 候选的段都出自写了判据的条件；段不在了，是人才库在这期间刚同步过
			if (!criterion || !segment)
				throw new Error("候选人的经历刚有变动：用 read 重新取这一批");
			const n = ++numbered;
			batch.segments.set(n, { criterion, content: segment.content });
			let group = groups.get(condition.id);
			if (!group) {
				group = { label: condition.label, criterion, segments: [] };
				groups.set(condition.id, group);
				batch.groups.push(group);
			}
			group.segments.push({ n, text: segment.text });
		}
		for (const { criterion } of batch.groups) given.add(criterion);
		fresh = batch;
		return { kind: "batch", batch, left };
	};

	/** 取经历的结果回给模型的样子。 */
	const deliveryReply = (delivery: Delivery) => {
		switch (delivery.kind) {
			case "batch":
				return {
					left: delivery.left,
					groups: delivery.batch.groups,
					todo: JUDGE_TODO,
				};
			case "none":
				return { left: delivery.left, todo: nextOf(delivery.left, room()) };
			case "unlisted":
				return {
					...probeReply(delivery.tried),
					todo: "这份条件跑不出名单，没有经历可读：先把有问题的那一条改好",
				};
		}
	};

	/** 取经历记进步骤的样子。 */
	const readTrace = (delivery: Delivery): TraceStep =>
		delivery.kind === "unlisted"
			? { at: Date.now(), tool: "read", unlisted: true }
			: {
					at: Date.now(),
					tool: "read",
					segments:
						delivery.kind === "batch" ? delivery.batch.segments.size : 0,
					left: delivery.left,
				};

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
					() => discover({ ...input, match }),
				);
				await log({
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
					() => findPhrases(inputs),
				);
				await log({
					at: Date.now(),
					tool: "find",
					found: found.map(foundTrace),
				});
				return found;
			},
		}),
		probe: tool({
			description:
				"试跑一份完整的条件：每条单独选中多少人（people；写了 seek 的是字面对得上的人，含还没看过的；exclude 是它最多会拦下的人）、名单上多少人（total），哪一条写不对或跑不了，候选人有多少（candidates）、他们还有多少段经历没看过（unread）。没看过的经历不算数，那些人还不在名单上。",
			inputSchema: z.object({ conditions: submissionSchema.shape.conditions }),
			execute: async ({ conditions }) => {
				const { query } = understood({ conditions }, base);
				// 标签也在回答里：只改了标签的同一份条件要回新的标签
				const key = query.conditions.map((c) => [c.label, contentKey(c)]);
				const tried = await once(
					JSON.stringify(["probe", concluded, key]),
					() => trial(query, rootTurnId),
				);
				await log({ at: Date.now(), tool: "probe", probe: probeTrace(tried) });
				return {
					...probeReply(tried),
					todo: nextOf(tried.unconfirmed.length, room()),
				};
			},
		}),
		read: tool({
			description:
				"取候选人还没看过的经历来读：这份条件找出的人，在写了 criterion 的条件上被正则捞到（没写正则的条件是 where 圈出的每一段）、你还没看过的那些段，一次一批，职级高的人在前。每段前面有编号 n，按所属的条件分组。读完紧接着用 judge 交上符合的段：中间去做别的，这一批就要重新取。",
			inputSchema: z.object({ conditions: submissionSchema.shape.conditions }),
			execute: async ({ conditions }) => {
				const delivery = await deliver(understood({ conditions }, base).query);
				await log(readTrace(delivery));
				return deliveryReply(delivery);
			},
		}),
		judge: tool({
			description:
				"交上刚读的这一批经历里符合的段：这一段里看得出他本人做过所属条件的 criterion 说的事。只是提到、配合，或者做的是相近的另一件事，不交；没交的都按不算记下。exclude 的条件一样判：这一段是 criterion 说的那种经历就交。一批只交一次，符合的编号全写在这一次里。照 criterion 里写明的算和不算来判，不看这段离现在多久、做了多长。交完会带回下一批，直到看完。",
			inputSchema: z.object({
				fits: z.array(z.int()).meta({
					description: "这一批里符合的段的编号；一段都不符合就给空数组",
				}),
			}),
			execute: async ({ fits }) => {
				const batch = hand;
				hand = null;
				if (!batch) {
					await log({ at: Date.now(), tool: "judge", redo: true });
					return { todo: "手上没有要交结论的经历：先用 read 取" };
				}
				const stray = fits.filter((n) => !batch.segments.has(n));
				if (stray.length > 0) {
					await log({ at: Date.now(), tool: "judge", redo: true });
					fresh = batch;
					return {
						problem: `编号 ${stray.join("、")} 不在这一批里，这一批的结论没有记下：照下面的编号重新交`,
						groups: batch.groups,
						todo: JUDGE_TODO,
					};
				}
				const chosen = new Set(fits);
				const verdicts = [...batch.segments].map(([n, segment]) => ({
					...segment,
					fits: chosen.has(n),
				}));
				await record(
					{
						at: Date.now(),
						tool: "judge",
						fits: chosen.size,
						unfit: verdicts.length - chosen.size,
					},
					verdicts,
				);
				concluded += verdicts.length;
				const next = await deliver(batch.query);
				// 读到头了不再记一步空的读：下结论那一步就是最后一步
				if (next.kind === "batch") await log(readTrace(next));
				return { saved: verdicts.length, ...deliveryReply(next) };
			},
		}),
		[SUBMIT]: tool({
			description:
				"提交整份新的条件和说明。检查通过，这一轮就结束；没通过会告诉你哪里有问题，改好再提交。只是找不到人或太宽、而这正是用户明说的要求时，把同一份条件原样再提交一次；写不对、跑不了、还有经历没看的原样再交也不收。",
			inputSchema: submissionSchema,
			execute: async (submitted) => {
				const resubmitted =
					last !== null &&
					JSON.stringify(last.submitted) === JSON.stringify(submitted);
				const checked = await checkSubmission(
					submitted,
					base,
					room(),
					given,
					rootTurnId,
				);
				const problems = resubmitted
					? checked.hard
					: [...checked.hard, ...checked.soft];
				last = {
					submitted,
					admitted: checked.admitted,
					unanswered: checked.unanswered,
					passed: problems.length === 0,
				};
				if (last.passed) return { passed: true };
				// 没通过的提交也记一步：HR 看得到哪里要改，这一次理解也留下了还在进行的痕迹
				await log({
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
		 * 最后一次检查完的提交录取的那份，和它算不算作答。次数用完时最后一次没通过也用它：
		 * 录取的那份里没有跑不了的条件，写进记录的就是它。还没提交过为 null。
		 */
		answer: () =>
			last && { admitted: last.admitted, unanswered: last.unanswered },
		/** 模型要走下一步了：上一步给出的那一批到了它眼前，再早的一批作废。每一步之前调用。 */
		advance: () => {
			hand = fresh;
			fresh = null;
		},
		/**
		 * 条件已经定了，只读经历：取这份条件的第一批，返回回给模型的那份。没有要读的（候选人的
		 * 都确认过了，或者这份条件出不了名单，名单那一侧有自己的说法）返回 null。
		 */
		begin: async (query: Query) => {
			const delivery = await deliver(query);
			if (delivery.kind !== "batch") return null;
			await log(readTrace(delivery));
			return deliveryReply(delivery);
		},
		/** 刚给出一批经历，等模型交结论。 */
		awaiting: () => fresh !== null,
		/** 读到头了：候选人的经历都确认过了，到了这一轮的上限，或者条件出不了名单。 */
		finished: () => ended,
	};
}

export type AgentTools = ReturnType<typeof agentTools>;
