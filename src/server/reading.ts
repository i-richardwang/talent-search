/**
 * 读经历：把一份条件的候选人还没确认过的段读完，一条判据下一段算不算，存成结论。
 *
 * 读是独立的一件事，不在查询理解的对话里：每一批是一次单独的模型请求（`Judge`，生产中是
 * `llm.ts` 的 `judgeSegments`），拿到的只有这一批经历和它们所属条件的标签、判据；HR 的话、
 * 别的条件、别的批次都不给。判据是全部的标准，所以同一条判据下同样内容的段在哪一轮读都是
 * 同一个结论，结论才能按「判据 × 段的内容」保存和沿用（`judged.ts`）。查询理解只看得到读的
 * 结果：每条读了多少段、多少段算数（`agent-tools.ts` 的 `read`）；HR 直接改条件、或者条件不变
 * 接着往下找时，没有对话，直接读（`turn.ts` 的 `confirmTurn`）。
 *
 * 一次读一波，一波分成几批同时读；一波的结论都写入后重新取当前候选，再读下一波：已经出局的人
 * 的其余经历不占额度，必须和排除的条件确认完才轮到加分的。职级高的人在前，一轮最多读
 * `READ_MAX` 段：人在等，读到这里为止，没读到的人不上名单（`search/empty.ts` 的 `Incomplete`）。
 */
import "@tanstack/react-start/server-only";
import { probe as probeQuery } from "#/search/execute";
import type { Query } from "#/search/query";
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

/** 一波读几段：同时读的那几批。 */
export const READ_WAVE = READ_BATCH * READ_PARALLEL;

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

/** 给模型读的一组经历：同一条条件下的几段，每段一个这一批之内的编号。 */
export type Group = {
	label: string;
	criterion: string;
	segments: { n: number; text: string }[];
};

/** 读一批经历：交回符合的段的编号，只能是这一批里的编号。 */
export type Judge = (
	groups: readonly Group[],
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

function chunks<T>(list: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

/** 一批要读的段写成给模型读的几组，连同编号对回哪条条件、哪条判据下的哪一段。 */
function batchOf(
	part: Unconfirmed,
	texts: Map<number, { content: string; text: string }>,
) {
	const segments = new Map<
		number,
		{ conditionId: string; label: string; criterion: string; content: string }
	>();
	const groups = new Map<string, Group>();
	for (const { condition, experienceId } of part) {
		const criterion = condition.seek?.criterion;
		const segment = texts.get(experienceId);
		// 候选的段都出自写了判据的条件；段不在了，是人才库在这期间刚同步过
		if (!criterion || !segment)
			throw new Error("候选人的经历刚有变动，这一次没有读完");
		const n = segments.size + 1;
		segments.set(n, {
			conditionId: condition.id,
			label: condition.label,
			criterion,
			content: segment.content,
		});
		let group = groups.get(condition.id);
		if (!group) {
			group = { label: condition.label, criterion, segments: [] };
			groups.set(condition.id, group);
		}
		group.segments.push({ n, text: segment.text });
	}
	return { segments, groups: [...groups.values()] };
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
	/** 这一轮读过的判据。 */
	const given = new Set<string>();
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
			const wave = tried.unconfirmed.slice(0, Math.min(READ_WAVE, room()));
			if (wave.length === 0)
				return { kind: "read", conditions: [...tally.values()], left };
			await record(
				{ at: Date.now(), tool: "read", segments: wave.length, left },
				[],
			);
			const texts = await segmentTexts([
				...new Set(wave.map((u) => u.experienceId)),
			]);
			const batches = await Promise.all(
				chunks(wave, READ_BATCH).map(async (part) => {
					const batch = batchOf(part, texts);
					const chosen = new Set(await judge(batch.groups, abortSignal));
					const judged = [...batch.segments].map(([n, segment]) => ({
						...segment,
						fits: chosen.has(n),
					}));
					await record(
						{
							at: Date.now(),
							tool: "judge",
							fits: chosen.size,
							unfit: judged.length - chosen.size,
						},
						judged.map(({ criterion, content, fits }) => ({
							criterion,
							content,
							fits,
						})),
					);
					return judged;
				}),
			);
			for (const { conditionId, label, criterion, fits } of batches.flat()) {
				const counted = tally.get(conditionId) ?? { label, read: 0, fits: 0 };
				tally.set(conditionId, counted);
				counted.read++;
				if (fits) counted.fits++;
				given.add(criterion);
				concluded++;
			}
		}
	}

	return {
		read,
		/** 这一轮还能读几段。 */
		room,
		/** 这一轮读过的判据。 */
		given: given as ReadonlySet<string>,
		/** 这一轮已经存下结论的段数：试跑的结果随它变。 */
		concluded: () => concluded,
	};
}
