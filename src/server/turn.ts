/**
 * 查询记录的持久化与理解。一条线性链表示一次找人任务，追加按链头行锁串行化。
 * 记录不可变；待理解末轮可以补全一次，或由下一次动作取代。
 *
 * 理解是写入这一轮的那个动作的后半段：说一句话写下一轮，服务端随即开始理解它。
 * 页面只读进度，打开、刷新、多开几次都不会再开始一次理解；重新开始只有一个入口，
 * 人点「重试」（`restartTurn`）。
 */
import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import type { SearchTurn } from "#/db/schema";
import { searchTurn } from "#/db/schema";
import { compileConditions } from "#/search/compile";
import type { Condition } from "#/search/condition";
import { scopeOf } from "#/search/execute";
import { type Choice, type TurnNotes, unanswered } from "#/search/intent";
import { keywordsOf } from "#/search/keywords";
import { vocabulary } from "#/search/search";
import { type QueryInput, queryOfSpec, type SearchSpec } from "#/search/spec";
import type { TraceStep } from "#/search/trace";
import { agentTools } from "./agent-tools";
import { streamFacts } from "./discover";
import { type EndpointFault, endpointFault } from "./endpoint";
import {
	STEP_LIMIT_MS,
	UnansweredError,
	understand,
	understandingConfigured,
} from "./llm";
import { compileWhere } from "./sandbox";

function newId() {
	return randomBytes(8).toString("base64url");
}

/**
 * 一次找人任务怎么问的：说话，还是填关键词。由链头定下，整条链不变——
 * 链头有原话就是对话，链头直接是条件就是关键词。两种链各走各的入口，不混。
 */
export type SearchMode = "conversation" | "keyword";

export type Turn = {
	id: string;
	rootTurnId: string;
	mode: SearchMode;
	/** 这次找人任务的标题：链头那句话。关键词搜索没有。 */
	title: string | null;
	/** 这一轮说的话；这一轮是直接改条件时为 null。 */
	said: string | null;
	/** null 表示模型理解尚未完成。 */
	spec: SearchSpec | null;
	notes: TurnNotes | null;
	/** 理解这一轮时模型走过的步骤；还在理解时是到目前为止的。没说话的一轮没有。 */
	trace: TraceStep[] | null;
	/** 这一次理解开始的时刻（epoch 毫秒）；没说话的一轮没有。 */
	startedAt: number | null;
	/** 这一次理解为什么没成；还在理解或已理解为 null。 */
	fault: InterpretFault | null;
	/** 这一轮写入记录的时刻（epoch 毫秒）：线程上这句话的时间。 */
	at: number;
};

/** 正在进行的这一次理解：走过的步骤和它开始的时刻。 */
export type Progress = { trace: TraceStep[]; startedAt: number | null };

/** 一轮理解现在怎样了。界面等理解时每秒读一次。 */
export type Interpretation = Progress & {
	fault: InterpretFault | null;
	/** 条件已经写进记录：该重新载入这一轮了。 */
	settled: boolean;
};

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 在 `parent` 后面写一条新记录。没有 `parent` 就是一条新链的链头。 */
async function insertTurn(
	tx: Db,
	row: {
		parent: SearchTurn | null;
		rawText: string | null;
		spec: SearchSpec | null;
	},
): Promise<SearchTurn> {
	const id = newId();
	// 说了一句话的一轮写下时就是第一次理解开始的时候
	const said = row.rawText !== null;
	const [inserted] = await tx
		.insert(searchTurn)
		.values({
			id,
			rootTurnId: row.parent ? row.parent.rootTurnId : id,
			parentTurnId: row.parent?.id ?? null,
			rawText: row.rawText,
			spec: row.spec,
			...(said && {
				interpretAttempt: newId(),
				interpretStartedAt: sql`now()`,
				trace: [],
			}),
		})
		.returning();
	if (!inserted) throw new Error("查询记录没能写入");
	return inserted;
}

async function getRow(id: string, tx: Db = db): Promise<SearchTurn | null> {
	const [row] = await tx.select().from(searchTurn).where(eq(searchTurn.id, id));
	return row ?? null;
}

/** 锁住链尾再读取状态，追加与模型补全在这条记录上串行化。调用方已持有链头锁。 */
async function tailOf(tx: Db, rootTurnId: string): Promise<SearchTurn> {
	const [tail] = await tx
		.select()
		.from(searchTurn)
		.where(
			and(
				eq(searchTurn.rootTurnId, rootTurnId),
				sql`not exists (select 1 from ${searchTurn} next
					where next.parent_turn_id = ${searchTurn.id})`,
			),
		)
		.for("update");
	if (!tail) throw new Error("查询记录链没有末轮");
	return tail;
}

function modeOf(rootRawText: string | null | undefined): SearchMode {
	return rootRawText ? "conversation" : "keyword";
}

/**
 * 关键词链只接受关键词框可完整读写的条件表；对话链可保存任意合法条件表。
 */
function admit(mode: SearchMode, input: QueryInput) {
	if (mode !== "keyword") return;
	if (input.kind === "sentence") throw new Error("关键词搜索不收一句话的需求");
	if (!("conditions" in input.spec) || !keywordsOf(input.spec.conditions))
		throw new Error("关键词搜索只收关键词框里写得出的条件");
}

/**
 * 写进记录之前，查询里每条条件的 `where` 都要过解析白名单：RPC 上来的和模型写的一样不可信，
 * 记录不可变，执行时才发现跑不了就晚了。
 */
async function admitWhere(input: QueryInput) {
	if (input.kind !== "spec" || !("query" in input.spec)) return;
	for (const c of input.spec.query.conditions) {
		const result = await compileWhere(c.where, c.params ?? {}, scopeOf(c));
		if (!result.ok)
			throw new Error(`搜索条件「${c.label}」不能执行：${result.problem}`);
	}
}

/**
 * 追加一轮查询；没有 from 时创建新链。完整条件表直接接链尾，原话依据正查看的那轮。
 * 在历史轮上补充原话时，先追加一次条件恢复，再追加待理解轮。
 * 待理解末轮由新动作取代；链头行锁串行化追加，唯一 parent_turn_id 保证不分叉。
 *
 * 说一句话的那一轮带着它第一次理解的编号返回：事务提交之后由调用方交给 `interpret`。
 */
export async function createTurn(
	input: QueryInput,
	from?: string,
): Promise<{ turnId: string; attempt: string | null }> {
	await admitWhere(input);
	return db.transaction(async (tx) => {
		const text = input.kind === "sentence" ? input.text : null;
		const spec = input.kind === "spec" ? input.spec : null;
		if (!from) {
			admit(text === null ? "keyword" : "conversation", input);
			const head = await insertTurn(tx, { parent: null, rawText: text, spec });
			return { turnId: head.id, attempt: head.interpretAttempt };
		}

		const rootTurnId = (await getRow(from, tx))?.rootTurnId;
		const [root] = rootTurnId
			? await tx
					.select()
					.from(searchTurn)
					.where(eq(searchTurn.id, rootTurnId))
					.for("update")
			: [];
		// 排在别的追加后面时，看着的那一轮可能刚被取代：拿到锁再读一遍
		const seen = root ? await getRow(from, tx) : null;
		if (!root || !seen) throw new Error("要修改的查询记录不存在");
		admit(modeOf(root.rawText), input);

		let tail: SearchTurn | null = await tailOf(tx, seen.rootTurnId);
		if (tail.spec === null) {
			await tx.delete(searchTurn).where(eq(searchTurn.id, tail.id));
			tail = tail.parentTurnId ? await getRow(tail.parentTurnId, tx) : null;
		}
		// 没理解出来的只可能是链尾；人看着它时，动作作用在它之前那一轮上
		const base = seen.spec ? seen : tail;
		if (!base && spec) throw new Error("还没有可以修改的搜索条件");

		let parent = tail;
		if (text !== null && base && tail && base.id !== tail.id)
			parent = await insertTurn(tx, {
				parent: tail,
				rawText: null,
				spec: base.spec,
			});
		// 原话只记这一轮说了什么。直接改条件的一轮没有说话；任务的标题是链头那句，
		// 不必往下抄。
		const turn = await insertTurn(tx, { parent, rawText: text, spec });
		return { turnId: turn.id, attempt: turn.interpretAttempt };
	});
}

/**
 * 这一轮为什么没理解出来。只有服务端知道是哪个环节出了问题，页面按它显示提示：
 * 连不上和报错时那句话根本没被读过，不能说成「这句话没读懂」。
 *
 * - `unconfigured`：没配查询理解端点。
 * - `unreachable` / `rejected`：见 `endpointFault`；一次请求等满超时也算没答上来。
 * - `unanswered`：端点答了，没按约定作答——只有这一种换个说法可能有用。
 * - `broken`：别的，我们自己这一侧的意外，包括理解到一半进程没了。原错误写进服务端日志。
 */
export type InterpretFault =
	| "unconfigured"
	| EndpointFault
	| "unanswered"
	| "broken";

/** 一步的工具跑完、写下这一步要的那一点时间，也是最后一步之后校验和写入结果的时间。 */
const SETTLE_MS = 10_000;

/**
 * 这一次理解最近一次写下东西的时刻：开始的时刻，或者最后一步的时刻（步骤的 `at`，见
 * `search/trace.ts`）。每次工具调用和没通过的提交都记一步，所以它就是心跳。
 */
const lastBeat = sql`greatest(${searchTurn.interpretStartedAt},
	to_timestamp((${searchTurn.trace} -> -1 ->> 'at')::float8 / 1000))`;

/**
 * 还没写下结果也没写下失败、而且隔了一步的上限还没有新的一步的那一次：它的进程没了，
 * 不会再写了。读记录时把它当作 `broken`，重试也只换掉这样的和已经失败的那一次。
 */
const abandoned = sql`(${searchTurn.spec} is null
	and ${searchTurn.interpretFault} is null
	and ${lastBeat} < now() - make_interval(secs => ${(STEP_LIMIT_MS + SETTLE_MS) / 1000}))`;

const currentFault = sql<InterpretFault | null>`case when ${abandoned}
	then 'broken' else ${searchTurn.interpretFault} end`;

/** 还是这一次理解在管的那一行：编号没被换掉，结果和失败原因都还没写下。 */
function ownedBy(turnId: string, attempt: string) {
	return and(
		eq(searchTurn.id, turnId),
		eq(searchTurn.interpretAttempt, attempt),
		isNull(searchTurn.spec),
		isNull(searchTurn.interpretFault),
	);
}

/**
 * 理解一轮，结果或失败原因写进记录。不抛：它在请求之外跑完，没有人接它的错误。
 *
 * 这一轮的基线是父记录的条件：一句「再加上带过团队的」只有放在那张表上才有意思。
 * 模型每查一次就往 `trace` 上追加一步，界面轮询它边跑边画。每一次写入都只写编号
 * 还是 `attempt` 的那一行：这一轮被下一句话取代、或这一次被重试换掉之后，它写不进来。
 */
export async function interpret(turnId: string, attempt: string) {
	let fault: InterpretFault | null;
	try {
		fault = await understandTurn(turnId, attempt);
	} catch (error) {
		console.error(`查询理解失败（记录 ${turnId}）：`, error);
		fault = interpretFault(error);
	}
	if (!fault) return;
	try {
		await db
			.update(searchTurn)
			.set({ interpretFault: fault })
			.where(ownedBy(turnId, attempt));
	} catch (error) {
		console.error(`查询理解失败原因没能写入（记录 ${turnId}）：`, error);
	}
}

async function understandTurn(
	turnId: string,
	attempt: string,
): Promise<InterpretFault | null> {
	if (!understandingConfigured()) return "unconfigured";
	const row = await getRow(turnId);
	// 这一轮已被下一句话取代，或这一次已被重试换掉
	if (row?.interpretAttempt !== attempt || row.rawText === null) return null;
	const rawText = row.rawText;
	const parent = row.parentTurnId ? await getRow(row.parentTurnId) : null;
	const base = parent?.spec ? queryOfSpec(parent.spec).conditions : [];

	// 读词表和调用模型各自读数据库，不共用一个快照：调用模型可能要一分钟，如果开着
	// 快照等它，一次理解就占着连接池里的一条连接一分钟。模型的工具在自己的快照里读
	// （`search/phrases.ts` 的 withMatchedPhrases）。
	const [vocab, streams] = await Promise.all([vocabulary(), streamFacts()]);
	const record = async (step: TraceStep) => {
		await db
			.update(searchTurn)
			.set({
				trace: sql`${searchTurn.trace} || ${JSON.stringify([step])}::jsonb`,
			})
			.where(ownedBy(turnId, attempt));
	};
	const agent = agentTools({ base, record });
	// 写进记录的是提交检查录取的那份：跑不了的条件已经丢掉，丢空了就是没作答
	const { submitted, admitted: result } = await understand(
		rawText,
		{ vocab, streams },
		base,
		agent,
	);
	const failure = unanswered(submitted, result);
	if (failure) throw new UnansweredError(failure);

	await db
		.update(searchTurn)
		.set({ spec: { query: result.query }, notes: result.notes })
		.where(ownedBy(turnId, attempt));
	return null;
}

function interpretFault(error: unknown): InterpretFault {
	const fault = endpointFault(error);
	if (fault) return fault;
	if (error instanceof UnansweredError) return "unanswered";
	return "broken";
}

/**
 * 人点了重试：上一次已经失败、或进程没了，就换一个编号重新开始，返回这个编号交给
 * `interpret`。上一次还在跑、或这一轮已经理解好，什么都不做，返回 null。
 * 新的一次从头计时，上一次走到一半的步骤不算进来。
 */
export async function restartTurn(turnId: string): Promise<string | null> {
	const [row] = await db
		.update(searchTurn)
		.set({
			interpretAttempt: newId(),
			interpretStartedAt: sql`now()`,
			interpretFault: null,
			trace: [],
		})
		.where(
			and(
				eq(searchTurn.id, turnId),
				sql`(${searchTurn.interpretFault} is not null or ${abandoned})`,
			),
		)
		.returning({ attempt: searchTurn.interpretAttempt });
	return row?.attempt ?? null;
}

/**
 * 这一条所在的整条链，链头在前。对话的线程画的就是它：每一轮说了什么、
 * 条件从哪张表改到哪张表（上一项的 `spec` 就是这一轮的基线）。看的是哪一轮都
 * 取整条链——回头看早先的结果，不会把后面的几轮藏起来。
 */
export async function loadThread(id: string): Promise<Turn[] | null> {
	const { rows } = await db.execute<{
		id: string;
		root_turn_id: string;
		raw_text: string | null;
		spec: SearchSpec | null;
		notes: TurnNotes | null;
		trace: TraceStep[] | null;
		started_at: number | null;
		fault: InterpretFault | null;
		at: number;
	}>(sql`
		with recursive line as (
			select id, 0 as depth from search_turn
			where id = (select root_turn_id from search_turn where id = ${id})
			union all
			select t.id, line.depth + 1
			from search_turn t join line on t.parent_turn_id = line.id
		)
		select ${searchTurn.id}, ${searchTurn.rootTurnId}, ${searchTurn.rawText},
			${searchTurn.spec}, ${searchTurn.notes}, ${searchTurn.trace},
			(extract(epoch from ${searchTurn.interpretStartedAt}) * 1000)::float8 as started_at,
			${currentFault} as fault,
			(extract(epoch from ${searchTurn.createdAt}) * 1000)::float8 as at
		from line join ${searchTurn} using (id) order by line.depth`);
	if (rows.length === 0) return null;
	const root = rows[0];
	const mode = modeOf(root?.raw_text);
	return rows.map((row) => ({
		id: row.id,
		rootTurnId: row.root_turn_id,
		mode,
		title: root?.raw_text ?? null,
		said: row.raw_text,
		spec: row.spec,
		notes: row.notes && notesOfRecord(row.notes),
		trace: row.trace,
		startedAt: row.started_at,
		fault: row.fault,
		at: row.at,
	}));
}

/**
 * 记录里的说明 → 界面读的说明。较早的记录里选项是旧条件表，当场编译成查询，和那一轮的
 * 条件编译出同样的 id。
 */
function notesOfRecord(notes: TurnNotes): TurnNotes {
	if (!notes.choices) return notes;
	const others = notes.choices.others.map((o): Choice => {
		const list = o.conditions as unknown[];
		return list.some((c) => (c as { about?: unknown }).about !== undefined)
			? { ...o, conditions: compileConditions(list as Condition[]).conditions }
			: o;
	});
	return { ...notes, choices: { ...notes.choices, others } };
}

/** 这一轮的理解现在怎样了；没有这一轮或这一轮没说话为 null。 */
export async function loadInterpretation(
	id: string,
): Promise<Interpretation | null> {
	const [row] = await db
		.select({
			trace: sql<TraceStep[]>`${searchTurn.trace}`,
			startedAt: sql<
				number | null
			>`(extract(epoch from ${searchTurn.interpretStartedAt}) * 1000)::float8`,
			fault: currentFault,
			settled: sql<boolean>`${searchTurn.spec} is not null`,
		})
		.from(searchTurn)
		.where(
			and(
				eq(searchTurn.id, id),
				sql`${searchTurn.interpretAttempt} is not null`,
			),
		);
	return row ?? null;
}

export type RecentSearch = {
	turnId: string;
	spec: SearchSpec;
	/** 这次找人任务的标题：链头那句话。关键词搜索没有。 */
	title: string | null;
	/** 最后一轮是多少秒以前写入的记录。在库里算，服务端直出与水合读到的是同一个数。 */
	ageSeconds: number;
	/** 最后一轮写入记录的时刻，`YYYY-MM-DD HH:MM` */
	at: string;
};

/** 最近搜索一页最多取多少条：页面要多少由它自己说，超过的按这个数取。 */
const RECENT_PAGE_MAX = 50;

export type RecentPage = {
	rows: RecentSearch[];
	total: number;
	next: string | null;
};

/** 游标保存精确时刻和 id；删除游标对应的记录不影响继续读取。 */
function recentCursor(raw: unknown): [string, string] | null {
	if (raw == null) return null;
	if (typeof raw !== "string" || raw.length > 160)
		throw new Error("搜索记录游标无效");
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new Error("搜索记录游标无效");
	}
	if (
		!Array.isArray(value) ||
		value.length !== 2 ||
		typeof value[0] !== "string" ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value[0]) ||
		!Number.isFinite(Date.parse(value[0])) ||
		typeof value[1] !== "string" ||
		!/^[\w-]{1,64}$/.test(value[1])
	)
		throw new Error("搜索记录游标无效");
	return [value[0], value[1]];
}

/**
 * 每条链最后一份完整条件表，按记录时间排列。待理解末轮之前的完整记录仍可回放。
 * 链序由 parent_turn_id 决定；时间仅用于跨任务展示与排序。
 */
export async function listRecent(
	size: number,
	after?: unknown,
): Promise<RecentPage> {
	const cursor = recentCursor(after);
	const limit = Math.min(Math.max(Math.trunc(size) || 1, 1), RECENT_PAGE_MAX);
	return db.transaction(
		async (store) => {
			const found = await store.execute<{ n: number }>(
				sql`select count(distinct root_turn_id)::int as n from search_turn where spec is not null`,
			);
			const result = await store.execute<
				RecentSearch & { cursorAt: string }
			>(sql`
				select latest.id as "turnId", latest.spec, root.raw_text as title,
					extract(epoch from now() - latest.created_at)::int as "ageSeconds",
					to_char(latest.created_at, 'YYYY-MM-DD HH24:MI') as at,
					to_char(latest.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' as "cursorAt"
				from search_turn latest join search_turn root on root.id = latest.root_turn_id
				where latest.spec is not null and not exists (
					select 1 from search_turn next
					where next.parent_turn_id = latest.id and next.spec is not null)
				${cursor ? sql`and (latest.created_at, latest.id) < (${cursor[0]}::timestamptz, ${cursor[1]})` : sql``}
				order by latest.created_at desc, latest.id desc limit ${limit + 1}`);
			const rows = result.rows.slice(0, limit);
			const last = rows.at(-1);
			return {
				total: found.rows[0]?.n ?? 0,
				rows: rows.map(({ cursorAt: _, ...row }) => row),
				next:
					result.rows.length > limit && last
						? JSON.stringify([last.cursorAt, last.turnId])
						: null,
			};
		},
		{ isolationLevel: "repeatable read" },
	);
}

/**
 * 删除给定记录所属的整条链，并返回全部被删 id，供当前页面离开已删记录。
 */
export async function deleteSearch(turnId: string): Promise<string[]> {
	const rows = await db
		.delete(searchTurn)
		.where(
			eq(
				searchTurn.rootTurnId,
				db
					.select({ root: searchTurn.rootTurnId })
					.from(searchTurn)
					.where(eq(searchTurn.id, turnId)),
			),
		)
		.returning({ id: searchTurn.id });
	return rows.map((one) => one.id);
}
