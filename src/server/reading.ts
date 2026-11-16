/**
 * 读经历：把一份条件的候选人还没确认过的段读完，一条判据下一段算不算，存成结论。
 *
 * 读是独立的一件事，不在查询理解的对话里：每一批是一次单独的模型请求（`Judge`，生产中是
 * `llm.ts` 的 `judgeSegments`），拿到的只有一条条件的标签、判据和这条条件的一批经历；HR 的话、
 * 别的条件、别的批次都不给。一批只有一条判据：模型只交符合的段，没交的按不算存下，一次请求里
 * 有几条判据时漏交一条看不出来。判据是全部的标准，所以同一条判据下同样内容的段在哪一轮读都是
 * 同一个结论，结论才能按「判据 × 段的内容」保存和沿用（`judged.ts`）。
 *
 * 一轮处理里只有一个读经历（`Reader`）：查询理解在对话里读（`agent-tools.ts` 的 `read`，它只看得到
 * 每条读了多少段、多少段算数），这一轮最后把候选人读完（`turn.ts` 的 `performAttempt`），不论
 * 条件是说一句话写出来的、HR 直接改的，还是条件不变接着往下找。
 *
 * 一次读一波，一波是同时读的几批；一波的结论都写入后重新取当前候选，再读下一波：已经出局的人
 * 的其余经历不占额度，必须和排除的条件确认完才轮到加分的。职级高的人在前，一轮最多读
 * `READ_MAX` 段：人在等，读到这里为止，没读到的人不上名单（`search/empty.ts` 的 `Incomplete`）。
 */
import "@tanstack/react-start/server-only";
import { probe as probeQuery } from "#/search/execute";
import type { Query, QueryCondition } from "#/search/query";
import type { TraceStep } from "#/search/trace";
import { positiveInt } from "./endpoint";
import { segmentTexts, type Verdict } from "./judged";

/** 一次请求给模型读几段经历。 */
export const READ_BATCH = 160;

/**
 * 一次查询同时读几批。定得小：几个人同时找人时各读各的，谁也不把端点的并发占满；整个进程
 * 同时发出几个请求另有上限（`llm.ts`），超出的排队。
 */
const READ_PARALLEL = 2;

/**
 * 一轮最多读几段：人在等，读到这里为止。`LLM_READ_MAX` 可以改，读得越多一轮等得越久、花得
 * 越多。
 */
export const READ_MAX = positiveInt(process.env.LLM_READ_MAX, 2560);

/** 记一步，连同这一步存下的结论（没有结论的步给空数组）：调用方把两样一起写入。 */
export type RecordStep = (
	step: TraceStep,
	verdicts: readonly Verdict[],
) => Promise<void>;

/** 给模型读的一批经历：同一条条件下的几段，每段一个这一批之内的编号。 */
export type Batch = {
	label: string;
	criterion: string;
	segments: { n: number; text: string }[];
};

/** 读一批经历：交回符合的段的编号，只能是这一批里的编号。 */
export type Judge = (
	batch: Batch,
	abortSignal?: AbortSignal,
) => Promise<number[]>;

/**
 * 试跑一份查询：每条启用的条件单独选中多少人、写不对的原因，名单和候选人的人数，太宽的那几条，
 * 连同候选人还没确认过的段。
 */
export async function trial(query: Query, rootTurnId: string) {
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

export type Trial = Awaited<ReturnType<typeof trial>>;

/**
 * 读的结果：每条条件这一次读了多少段、多少段算数，候选人还剩多少段没确认；或者这份条件
 * 出不了名单（有一条跑不了，或者找出的太多），没有经历可读。
 */
export type Reading =
	| {
			kind: "read";
			conditions: { label: string; read: number; fits: number }[];
			left: number;
	  }
	| { kind: "unlisted"; tried: Trial };

type Unconfirmed = Trial["unconfirmed"];

/** 一批要读的段：同一条条件的，读的时候照它的判据。 */
type Part = {
	condition: QueryCondition;
	criterion: string;
	experienceIds: number[];
};

/**
 * 这一波读哪几批：没确认过的段按条件分开，一条条件每 `READ_BATCH` 段一批，批按第一段出现的先后
 * 排（段的顺序是职级高的人在前），取最前的 `READ_PARALLEL` 批，总共不超过 `room` 段。
 */
function waveOf(unconfirmed: Unconfirmed, room: number): Part[] {
	// 每条条件正在攒的那一批；攒满了，下一段另起一批
	const open = new Map<string, Part>();
	const parts: Part[] = [];
	for (const { condition, experienceId } of unconfirmed) {
		const criterion = condition.seek?.criterion;
		// 没写判据的条件没有要确认的段
		if (!criterion) continue;
		let part = open.get(condition.id);
		if (!part || part.experienceIds.length === READ_BATCH) {
			part = { condition, criterion, experienceIds: [] };
			open.set(condition.id, part);
			parts.push(part);
		}
		part.experienceIds.push(experienceId);
	}
	const wave: Part[] = [];
	let taken = 0;
	for (const part of parts.slice(0, READ_PARALLEL)) {
		const experienceIds = part.experienceIds.slice(0, room - taken);
		if (experienceIds.length === 0) break;
		wave.push({ ...part, experienceIds });
		taken += experienceIds.length;
	}
	return wave;
}

/**
 * 一轮处理里的读经历。`rootTurnId` 是这一轮所在的找人任务：结论记在它名下，也只认它名下的；
 * `record` 把每一步和这一步的结论一起写入；`judge` 读一批。
 */
export function reader({
	rootTurnId,
	record,
	judge,
}: {
	rootTurnId: string;
	record: RecordStep;
	judge: Judge;
}) {
	/** 这一轮已经存下结论的段数。 */
	let concluded = 0;
	const room = () => READ_MAX - concluded;

	/** 把这份条件的候选人还没确认过的经历读完，或者读到这一轮的上限。 */
	async function read(
		query: Query,
		abortSignal?: AbortSignal,
	): Promise<Reading> {
		const tally = new Map<
			string,
			{ label: string; read: number; fits: number }
		>();
		for (;;) {
			const tried = await trial(query, rootTurnId);
			if (tried.total === null) return { kind: "unlisted", tried };
			const left = tried.unconfirmed.length;
			const wave = waveOf(tried.unconfirmed, room());
			if (wave.length === 0)
				return { kind: "read", conditions: [...tally.values()], left };
			const experienceIds = wave.flatMap((part) => part.experienceIds);
			await record(
				{ at: Date.now(), tool: "read", segments: experienceIds.length, left },
				[],
			);
			const texts = await segmentTexts([...new Set(experienceIds)]);
			const batches = await Promise.all(
				wave.map(async ({ condition, criterion, experienceIds }) => {
					const segments = experienceIds.map((id) => {
						const segment = texts.get(id);
						// 段不在了，是人才库在这期间刚同步过
						if (!segment)
							throw new Error("候选人的经历刚有变动，这一次没有读完");
						return segment;
					});
					// 一段的编号是它在这一批里排第几
					const chosen = new Set(
						await judge(
							{
								label: condition.label,
								criterion,
								segments: segments.map(({ text }, i) => ({ n: i + 1, text })),
							},
							abortSignal,
						),
					);
					await record(
						{
							at: Date.now(),
							tool: "judge",
							fits: chosen.size,
							unfit: segments.length - chosen.size,
						},
						segments.map(({ content }, i) => ({
							criterion,
							content,
							fits: chosen.has(i + 1),
						})),
					);
					return {
						condition,
						read: segments.length,
						fits: chosen.size,
					};
				}),
			);
			for (const { condition, read, fits } of batches) {
				const counted = tally.get(condition.id) ?? {
					label: condition.label,
					read: 0,
					fits: 0,
				};
				tally.set(condition.id, counted);
				counted.read += read;
				counted.fits += fits;
				concluded += read;
			}
		}
	}

	return {
		read,
		/** 这一轮还能读几段。 */
		room,
		/** 这一轮已经存下结论的段数：试跑的结果随它变。 */
		concluded: () => concluded,
	};
}

/** 一轮处理里唯一的读经历：AI 在对话里读和这一轮最后把候选人读完，共用它的额度。 */
export type Reader = ReturnType<typeof reader>;
