/** 查询记录的持久化与派生规则。记录不可变；唯一更新是补全待理解记录。 */
import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import type { SearchTurn } from "#/db/schema";
import { searchTurn } from "#/db/schema";
import { toSpec } from "#/search/intent";
import { type Requirement, withOff } from "#/search/requirement";
import { probeWide, vocabulary } from "#/search/search";
import {
	normalizeSpec,
	type QueryInput,
	type SearchNotice,
	type SearchSpec,
} from "#/search/spec";
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
	// 改一枚条件不改「问的是什么」，原话原样带下来——它是这条查询的门面，
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
 * 给这句话新解析出的词量一遍宽度：命中的人多到几乎不筛人的，**可见地**停用，
 * 并留下一条说明成因的注解。
 *
 * 用户自己的说法太宽，停整条要求并注明；模型补的变体太宽，只丢那个变体，
 * 不注明——它是替用户补的、用户没见过，一个用户没说过的宽词不该把整条要求
 * 停掉，也没有「你说的词太宽」可解释。
 *
 * **只量正向要求的词。** 宽度这把尺答的是「它还筛不筛得掉人」，那是准入的问题；
 * 排除词答的是「哪一段不作数」，命中面广恰恰是它在起作用，量它等于用一把
 * 反向的尺去停掉一条正在生效的条件。门槛也对不上：`probeWide` 按
 * `RELEVANCE_MIN` 量，而排除按更高的 `RELEVANCE_MIN_EXCLUDE` 判——
 * 量出来的宽根本不是它搜出来的宽。
 *
 * 成因落在 notices 上，不落在要求上：宽是**语料**的事实，会随语料重灌后失效，
 * 而要求是记录里不可变的那一半（论证在 `requirement.ts`）。
 */
async function benchWide(
	requirements: Requirement[],
): Promise<{ requirements: Requirement[]; notices: SearchNotice[] }> {
	const admitting = requirements.filter((r) => r.mode !== "exclude");
	const wide = await probeWide([
		...new Set(admitting.flatMap((r) => r.members.map((m) => m.text))),
	]);
	const notices: SearchNotice[] = [];
	const benched = requirements.map((r): Requirement => {
		if (r.mode === "exclude") return r;
		const [first, ...rest] = r.members;
		const kept: Requirement = {
			...r,
			members: [
				first,
				...rest.filter((m) => m.tier === "said" || !wide.has(m.text)),
			],
		};
		if (!r.members.some((m) => m.tier === "said" && wide.has(m.text)))
			return kept;
		notices.push({ kind: "wide", term: first.text });
		return withOff(kept, true);
	});
	return { requirements: benched, notices };
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

	// 三段各自站在自己的那一版语料上，中间不持着语料锁：词表是一次短读取，
	// 模型那一跳在语料锁外（它可以慢到一分钟），量宽自己走一遍准入
	// （`search/phrases.ts` 的 withAdmission）。持着语料锁等模型的话，一次理解
	// 就能把排在待发布 ETL 后面的每一个检索一起堵住。
	const vocab = await vocabulary();
	const understood = toSpec(await understand(rawText, vocab), vocab);
	const benched = await benchWide(understood.requirements);
	const spec = normalizeSpec({
		...understood,
		requirements: benched.requirements,
		notices: [...understood.notices, ...benched.notices],
	});

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
 * 原话取的是**这一条自己的** `raw_text`，不回溯根记录：改一枚 chip 派生出来的
 * 记录会把原话原样带下来（见 `createTurn`），而重新说一句话派生出来的记录带的
 * 是新的那句——两种情况下它都和这里显示的 spec 出自同一次提问。回溯根记录则会
 * 在后一种情况下拿旧话去给新条件当门面。
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
