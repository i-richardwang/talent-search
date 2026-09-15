/**
 * 查询记录的持久化与派生规则。记录不可变：能改的只有补全待理解记录那一列，
 * 能删的只有整条链（`deleteSearch`）。
 */
import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import type { SearchTurn } from "#/db/schema";
import { searchTurn } from "#/db/schema";
import {
	type Condition,
	type ExperienceCondition,
	withOff,
} from "#/search/condition";
import { allDropped, toSpec } from "#/search/intent";
import { probeWide, vocabulary } from "#/search/search";
import type { QueryInput, SearchSpec } from "#/search/spec";
import { understand } from "./llm";

function newId() {
	return randomBytes(8).toString("base64url");
}

export type Turn = {
	id: string;
	rootTurnId: string;
	rawText: string | null;
	/** null 表示模型理解尚未落下。 */
	spec: SearchSpec | null;
};

function toTurn(row: SearchTurn): Turn {
	return {
		id: row.id,
		rootTurnId: row.rootTurnId,
		rawText: row.rawText,
		spec: row.spec,
	};
}

/**
 * 落一条新记录，交出它的 id。
 *
 * 父记录只决定这一条挂在**哪条链**上（`root_turn_id`）和原话从哪儿来；
 * 「上一步是谁」不进库——后退是浏览器的事，「最近搜索」按 root 去重，
 * 没有第三个读者会问这条边。
 */
async function insertTurn(row: {
	parent: SearchTurn | null;
	rawText: string | null;
	spec?: SearchSpec | null;
}): Promise<string> {
	const id = newId();
	await db.insert(searchTurn).values({
		id,
		rootTurnId: row.parent ? row.parent.rootTurnId : id,
		rawText: row.rawText,
		spec: row.spec ?? null,
	});
	return id;
}

async function getRow(id: string): Promise<SearchTurn | null> {
	const [row] = await db.select().from(searchTurn).where(eq(searchTurn.id, id));
	return row ?? null;
}

/** 落一条新查询或从既有记录派生一条，不在导航前等待模型。 */
export async function createTurn(
	input: QueryInput,
	parentTurnId?: string,
): Promise<{ turnId: string }> {
	const parent = parentTurnId ? await getRow(parentTurnId) : null;
	if (parentTurnId && !parent) throw new Error("要修改的查询记录不存在");
	if (parent && parent.spec === null)
		throw new Error("查询仍在理解中，暂时不能派生新记录");

	if (input.kind === "sentence")
		return { turnId: await insertTurn({ parent, rawText: input.text }) };
	// 改一个条件不改「问的是什么」，原话原样带下来——它是这条查询的标题，
	// 屏幕上那一行、最近搜索里那一条读的都是它。
	return {
		turnId: await insertTurn({
			parent,
			rawText: parent?.rawText ?? null,
			spec: input.spec,
		}),
	};
}

/**
 * 给这句话新写出的经历词量一遍宽度：命中的人多到几乎不筛人的词丢掉；
 * 一条主张的经历词全宽，整条**可见地**停用，成因记在 `off` 上。
 *
 * 一条主张里几个词同权，宽的那个丢掉不影响其余的词找人；全宽才说明这条
 * 主张本身几乎不筛人，那得让用户看见、换词，或者坚持启用——检索层不做无声拦截。
 * 两支看起来不对称，其实是同一条规则：**这份查询还没有人看过。** 它是模型
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
async function benchWide(conditions: Condition[]): Promise<Condition[]> {
	const measured = (
		c: Condition,
	): c is ExperienceCondition & { what: readonly [string, ...string[]] } =>
		c.about === "experience" && c.mode !== "exclude" && c.what !== undefined;
	const wide = await probeWide([
		...new Set(conditions.filter(measured).flatMap((c) => c.what)),
	]);
	return conditions.map((c): Condition => {
		if (!measured(c)) return c;
		const [first, ...rest] = c.what.filter((v) => !wide.has(v));
		if (!first) return withOff(c, "wide");
		return { ...c, what: [first, ...rest] };
	});
}

/**
 * 补全一次自然语言理解。模型那一跳失败就原样抛出，记录停在「待理解」，
 * 界面据此画出错误与重试；并发更新通过 `spec is null` 保证先到者获胜，
 * 晚到者读回同一份最终结果。
 */
export async function resolveTurn(turnId: string): Promise<SearchSpec> {
	const row = await getRow(turnId);
	if (!row) throw new Error("查询记录不存在");
	if (row.spec) return row.spec;
	if (row.rawText === null) throw new Error("待理解记录缺少原话");
	const rawText = row.rawText;

	// 三段各自站在自己的语料快照上，中间不占着快照：词表是一次短读取，
	// 模型那一跳在快照外（它可以慢到一分钟），量宽自己走一遍准入
	// （`search/phrases.ts` 的 withAdmission）。占着快照等模型的话，一次理解
	// 就占着池里的一条连接一分钟。
	const vocab = await vocabulary();
	const raw = await understand(rawText, vocab);
	const understood = toSpec(raw, vocab);
	// 模型给了条件、收窄后一个不剩：这是模型那一跳失败，不是一句没有条件的话。
	// 抛出来和超时、限流走同一条路——记录停在「待理解」，界面画错误与重试。
	if (allDropped(raw, understood))
		throw new Error(
			`查询理解给出的条件全部不合规，收窄后一个不剩：${JSON.stringify(
				(raw as { conditions?: unknown }).conditions,
			).slice(0, 400)}`,
		);
	const spec: SearchSpec = {
		conditions: await benchWide(understood.conditions),
	};

	await db
		.update(searchTurn)
		.set({ spec })
		.where(and(eq(searchTurn.id, row.id), isNull(searchTurn.spec)));

	const resolved = await getRow(row.id);
	if (!resolved?.spec) throw new Error("查询理解结果未能落库");
	return resolved.spec;
}

export async function loadTurn(id: string): Promise<Turn | null> {
	const row = await getRow(id);
	return row ? toTurn(row) : null;
}

const RECENT_MAX = 8;

export type RecentSearch = {
	turnId: string;
	spec: SearchSpec;
	rawText: string | null;
};

/**
 * 每条派生链只展示最后一份完整查询；打开 turnId 即可精确回放全部条件。
 *
 * 原话取的是**这一条自己的** `raw_text`，不回溯根记录：改一个 chip 派生出来的
 * 记录会把原话原样带下来（见 `createTurn`），而重新说一句话派生出来的记录带的
 * 是新的那句——两种情况下它都和这里显示的 spec 出自同一次提问。回溯根记录则会
 * 在后一种情况下拿旧话去给新条件当标题。
 */
export async function listRecent(): Promise<RecentSearch[]> {
	const rows = await db.execute<{
		id: string;
		spec: SearchSpec;
		raw_text: string | null;
	}>(sql`
			select id, spec, raw_text from (
				select distinct on (root_turn_id) id, root_turn_id, spec, raw_text, created_at
				from search_turn where spec is not null
				order by root_turn_id, created_at desc, id desc
			) latest
			order by latest.created_at desc, latest.id desc
			limit ${RECENT_MAX}`);
	return rows.rows.map((row) => ({
		turnId: row.id,
		spec: row.spec,
		rawText: row.raw_text,
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
