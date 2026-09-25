/**
 * 查询记录的持久化与派生规则。一条链是一次找人任务，链上每一条是一轮：
 * 上一轮的条件加上这一轮的动作（说一句话，或直接改条件）得出新的条件。
 * 链是一条线，新的一轮只接在最后（`createTurn`）。
 * 记录不可变：能改的只有补全待理解记录那两列；能删的是整条链（`deleteSearch`），
 * 以及被下一次动作取代的、没理解出来的末轮。
 */
import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import type { SearchTurn } from "#/db/schema";
import { searchTurn } from "#/db/schema";
import {
	type Condition,
	conditionKey,
	type ExperienceCondition,
	withOff,
} from "#/search/condition";
import { type TurnNotes, unanswered, understood } from "#/search/intent";
import { keywordsOf } from "#/search/keywords";
import { probeWide, vocabulary } from "#/search/search";
import type { QueryInput, SearchSpec } from "#/search/spec";
import type { TraceStep } from "#/search/trace";
import { agentTools } from "./agent-tools";
import { type EndpointFault, endpointFault } from "./endpoint";
import { UnansweredError, understand, understandingConfigured } from "./llm";

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
	/** null 表示模型理解尚未落下。 */
	spec: SearchSpec | null;
	notes: TurnNotes | null;
	/** 理解这一轮时模型走过的步骤；还在理解时是到目前为止的。关键词的记录没有。 */
	trace: TraceStep[] | null;
};

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 在 `parent` 后面落一条新记录。没有 `parent` 就是一条新链的链头。 */
async function insertTurn(
	tx: Db,
	row: {
		parent: SearchTurn | null;
		rawText: string | null;
		spec: SearchSpec | null;
	},
): Promise<SearchTurn> {
	const id = newId();
	const [inserted] = await tx
		.insert(searchTurn)
		.values({
			id,
			rootTurnId: row.parent ? row.parent.rootTurnId : id,
			parentTurnId: row.parent?.id ?? null,
			rawText: row.rawText,
			spec: row.spec,
		})
		.returning();
	if (!inserted) throw new Error("查询记录未能落库");
	return inserted;
}

async function getRow(id: string, tx: Db = db): Promise<SearchTurn | null> {
	const [row] = await tx.select().from(searchTurn).where(eq(searchTurn.id, id));
	return row ?? null;
}

/** 一条链的最后一轮：链上唯一没有下一轮的那条。 */
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
		);
	if (!tail) throw new Error("查询记录链没有末轮");
	return tail;
}

function modeOf(rootRawText: string | null | undefined): SearchMode {
	return rootRawText ? "conversation" : "keyword";
}

/**
 * 关键词搜索的链只收那几个框写得出的条件表：一句话进不来，别的形状也进不来。
 * 结果页要把当前的查询填回框里接着改，框表达不了的一条既填不回去，也就改不了、
 * 看不见。对话的链上什么形状都行——chip 上的改动、搜不了时一键添加的替代条件，
 * 都是条件表。
 */
function admit(mode: SearchMode, input: QueryInput) {
	if (mode !== "keyword") return;
	if (input.kind === "sentence") throw new Error("关键词搜索不收一句话的需求");
	if (!keywordsOf(input.spec.conditions))
		throw new Error("关键词搜索只收关键词框里写得出的条件");
}

/**
 * 落一轮新查询，不在导航前等待模型。没有 `from` 就开一条新链。
 *
 * 链是一条线：新的一轮总接在链尾，所以回头看过去某一轮的结果，后面那几轮
 * 照样在线程里。`from` 是人正看着的那一轮，动作作用在**它的**条件上：
 *
 * - 交一整张表（chip 上的改动、替代条件、关键词框）不依赖基线，接在链尾。
 * - 说一句话要有基线。`from` 就是链尾时直接接上；是更早的一轮时，先追加一轮
 *   原样抄回那一轮的条件，话再接在后面。线程里那一步记成一次修改，基线
 *   仍然是这句话的上一轮——每一轮都是真实发生过的一步。
 *
 * 链尾还没理解出来的那一轮不算数：新的动作取代它（没作答时换个说法重说，
 * 就是这一步）。同一条链上的追加按链头的行锁排队，`search_turn_line`
 * 保证链不分叉。
 */
export async function createTurn(
	input: QueryInput,
	from?: string,
): Promise<{ turnId: string }> {
	return db.transaction(async (tx) => {
		const text = input.kind === "sentence" ? input.text : null;
		const spec = input.kind === "spec" ? input.spec : null;
		if (!from) {
			admit(text === null ? "keyword" : "conversation", input);
			const head = await insertTurn(tx, { parent: null, rawText: text, spec });
			return { turnId: head.id };
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
		return { turnId: turn.id };
	});
}

/**
 * 给这一轮新写出的经历词量一遍宽度：命中的人多到几乎不筛人的词丢掉；
 * 条件表和每一条搜不了的要求附带的替代条件各是一组，一次量完。替代条件也是
 * 模型写的，同样没有人看过；在这里量过，用户点「加上」时才能原样提交。
 * 一条主张的经历词全宽，整条**可见地**停用，成因记在 `off` 上。
 *
 * 一条主张里几个词同权，宽的那个丢掉不影响其余的词找人；全宽才说明这条
 * 主张本身几乎不筛人，那得让用户看见、换词，或者坚持启用——检索层不做无声拦截。
 * 两支看起来不对称，其实是同一条规则：**这些条件还没有人看过。** 它是模型
 * 刚写出来的，量宽是写这条搜索的最后一步，丢一个词和模型少写一个词是
 * 同一件事，落库之后 chip 上写的就是搜的。整条停用则不同——一条主张消失和
 * 一个词消失不一样，前者是「你说的这件事没法用来找人」，得说出来。词全宽也
 * 不把它降成一条没有词的主张：那会让「做过运营的」悄悄变成「有过任何经历的」。
 *
 * **只量正向主张的词。** 宽度这个指标答的是「它还筛不筛得掉人」，那是准入的问题；
 * 排除答的是「哪一段不作数」，命中面广恰恰是它在起作用，量它等于用一把
 * 反向的尺去停掉一条正在生效的条件。门槛也对不上：`probeWide` 按
 * `RELEVANCE_MIN` 量，而排除按更高的 `RELEVANCE_MIN_EXCLUDE` 判——
 * 量出来的宽根本不是它搜出来的宽。
 */
async function benchWide(
	groups: readonly Condition[][],
	base: readonly Condition[],
): Promise<Condition[][]> {
	// 上一轮已经有的条件不量：它量过了，或者用户看过、坚持启用了。
	const had = new Set(base.map(conditionKey));
	const measured = (
		c: Condition,
	): c is ExperienceCondition & { what: readonly [string, ...string[]] } =>
		c.about === "experience" &&
		c.mode !== "exclude" &&
		c.what !== undefined &&
		!had.has(conditionKey(c));
	const wide = await probeWide([
		...new Set(
			groups
				.flat()
				.filter(measured)
				.flatMap((c) => c.what),
		),
	]);
	return groups.map((conditions) =>
		conditions.map((c): Condition => {
			if (!measured(c)) return c;
			const [first, ...rest] = c.what.filter((v) => !wide.has(v));
			if (!first) return withOff(c, "wide");
			return { ...c, what: [first, ...rest] };
		}),
	);
}

/**
 * 补全一次自然语言理解。模型那一跳失败就原样抛出，记录停在「待理解」，
 * 界面据此画出错误与重试；并发更新通过 `spec is null` 保证先到者获胜，
 * 晚到者读回同一份最终结果。
 *
 * 这一轮的基线是父记录的条件：一句「再加上带过团队的」只有放在那张表上才有意思。
 *
 * 模型每用一次工具就往 `trace` 上追加一步，界面轮询它（`turnTrace`）边跑边画。
 * 重来一次先清空：上一次失败的半截过程不该接在这一次前面。
 */
export async function resolveTurn(turnId: string): Promise<SearchSpec> {
	const row = await getRow(turnId);
	if (!row) throw new Error("查询记录不存在");
	if (row.spec) return row.spec;
	if (row.rawText === null) throw new Error("待理解记录缺少原话");
	const rawText = row.rawText;
	const parent = row.parentTurnId ? await getRow(row.parentTurnId) : null;
	const base = parent?.spec?.conditions ?? [];

	// 三段各自站在自己的语料快照上，中间不占着快照：词表是一次短读取，
	// 模型那一跳在快照外（它可以慢到一分钟），量宽自己走一遍准入
	// （`search/phrases.ts` 的 withAdmission）。占着快照等模型的话，一次理解
	// 就占着池里的一条连接一分钟。
	const vocab = await vocabulary();
	await db
		.update(searchTurn)
		.set({ trace: [] })
		.where(and(eq(searchTurn.id, row.id), isNull(searchTurn.spec)));
	const record = async (step: TraceStep) => {
		await db.execute(sql`
			update search_turn
			set trace = coalesce(trace, '[]'::jsonb) || ${JSON.stringify([step])}::jsonb
			where id = ${row.id} and spec is null`);
	};
	const tools = agentTools({ vocab, base, record });
	const raw = await understand(rawText, vocab, base, tools);
	const result = understood(raw, vocab, base);
	// 没作答也抛：记录停在「待理解」，由 `interpret` 分出是哪一环坏了。
	const failure = unanswered(raw, result);
	if (failure) throw new UnansweredError(failure);
	const declined = result.notes?.declined ?? [];
	const [conditions = [], ...insteads] = await benchWide(
		[result.spec.conditions, ...declined.map((d) => d.instead)],
		base,
	);
	const spec: SearchSpec = { conditions };
	const notes = result.notes && {
		...result.notes,
		declined: declined.map((d, i) => ({ ...d, instead: insteads[i] ?? [] })),
	};

	await db
		.update(searchTurn)
		.set({ spec, notes })
		.where(and(eq(searchTurn.id, row.id), isNull(searchTurn.spec)));

	const resolved = await getRow(row.id);
	if (!resolved?.spec) throw new Error("查询理解结果未能落库");
	return resolved.spec;
}

/**
 * 这一轮为什么没理解出来。只有服务端知道是哪一环坏了，页面按它说话：
 * 连不上和报错时那句话根本没被读过，不能说成「这句话没读懂」。
 *
 * - `unconfigured`：没配查询理解端点。
 * - `unreachable` / `rejected`：见 `endpointFault`。
 * - `unanswered`：端点答了，没按约定作答——只有这一种换个说法可能有用。
 * - `broken`：别的，我们自己这一侧的意外。原错误写进服务端日志。
 */
export type InterpretFault =
	| "unconfigured"
	| EndpointFault
	| "unanswered"
	| "broken";

/** 补全一次理解，失败时交回是哪一环坏了。原错误只进服务端日志，不出门。 */
export async function interpret(
	turnId: string,
): Promise<{ fault: InterpretFault | null }> {
	if (!understandingConfigured()) return { fault: "unconfigured" };
	try {
		await resolveTurn(turnId);
		return { fault: null };
	} catch (error) {
		console.error(`查询理解失败（记录 ${turnId}）：`, error);
		return { fault: interpretFault(error) };
	}
}

function interpretFault(error: unknown): InterpretFault {
	const fault = endpointFault(error);
	if (fault) return fault;
	if (error instanceof UnansweredError) return "unanswered";
	return "broken";
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
	}>(sql`
		with recursive line as (
			select id, root_turn_id, raw_text, spec, notes, trace, 0 as depth
			from search_turn
			where id = (select root_turn_id from search_turn where id = ${id})
			union all
			select t.id, t.root_turn_id, t.raw_text, t.spec, t.notes, t.trace,
				line.depth + 1
			from search_turn t join line on t.parent_turn_id = line.id
		)
		select id, root_turn_id, raw_text, spec, notes, trace from line order by depth`);
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
		notes: row.notes,
		trace: row.trace,
	}));
}

/** 一条记录理解到哪一步了：界面在等理解时轮询它。 */
export async function traceOf(
	id: string,
): Promise<{ settled: boolean; trace: TraceStep[] } | null> {
	const row = await getRow(id);
	if (!row) return null;
	return { settled: row.spec !== null, trace: row.trace ?? [] };
}

export async function loadTurn(id: string): Promise<Turn | null> {
	const thread = await loadThread(id);
	return thread?.find((turn) => turn.id === id) ?? null;
}

const RECENT_MAX = 8;

export type RecentSearch = {
	turnId: string;
	spec: SearchSpec;
	/** 这次找人任务的标题：链头那句话。关键词搜索没有。 */
	title: string | null;
};

/**
 * 每条链只展示最后一份完整查询；打开 turnId 即可精确回放全部条件。
 * 标题是链头那句话：一次找人任务从那句话开始，后面每一轮都是在它上面改。
 */
export async function listRecent(): Promise<RecentSearch[]> {
	const rows = await db.execute<{
		id: string;
		spec: SearchSpec;
		title: string | null;
	}>(sql`
			select latest.id, latest.spec, root.raw_text as title from (
				select distinct on (root_turn_id) id, root_turn_id, spec, created_at
				from search_turn where spec is not null
				order by root_turn_id, created_at desc, id desc
			) latest
			join search_turn root on root.id = latest.root_turn_id
			order by latest.created_at desc, latest.id desc
			limit ${RECENT_MAX}`);
	return rows.rows.map((row) => ({
		turnId: row.id,
		spec: row.spec,
		title: row.title,
	}));
}

/**
 * 删掉一次找人任务：这条记录所在的整条链，返回删掉的每一条的 id。
 *
 * 「最近搜索」一行就是一条链，删一行就是删这条链——只删最后那一条的话，
 * 上一条会顶上来，那一行还在，只是退回了早一点的样子，和用户要的正相反。
 * 一条语句删完整条链：链上每一条（含链头自己）的 `root_turn_id` 都是链头。
 *
 * 返回 id 是给界面的：人正看着的那一屏可能就在这条链上，删完得离开它。
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
