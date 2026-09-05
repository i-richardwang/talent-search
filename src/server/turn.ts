/** 查询记录的持久化与派生规则。记录不可变；唯一更新是补全待理解记录。 */
import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import type { SearchTurn } from "#/db/schema";
import { searchTurn } from "#/db/schema";
import { resolveIntent } from "#/search/intent";
import { editChip, parseChips } from "#/search/parse";
import { probeWide, vocabulary } from "#/search/search";
import {
	fellBack,
	normalizeSpec,
	type QueryInput,
	type SearchDelta,
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
	/** 当前这句话是否因模型不可用而值得直接重试。 */
	canReinterpret: boolean;
};

function toTurn(row: SearchTurn): Turn {
	return {
		id: row.id,
		rootTurnId: row.rootTurnId,
		rawText: row.rawText,
		spec: row.spec,
		canReinterpret: row.delta ? fellBack(row.delta) : false,
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
	// delta 不在这里落：它是**理解的产物**，只可能由 resolveTurn 补上去。
	// 给它开一个入口，就等于让「还没理解」和「理解过了」多一种写法。
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

	if (input.kind === "reinterpret") {
		if (!parent?.rawText || !parent.delta)
			throw new Error("重新理解需要一条由整句产生的父记录");
		if (!fellBack(parent.delta))
			throw new Error("这条理解没有降级，重新理解不会得到不同的结果");
		return { turnId: await insertTurn({ parent, rawText: parent.rawText }) };
	}
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
 * **只量进门的词。** 宽度这把尺答的是「它还筛不筛得掉人」，那是准入的问题；
 * 排除词答的是「哪一段不作数」，命中面广恰恰是它在起作用，量它等于用一把
 * 反向的尺去停掉一条正在生效的条件。门槛也对不上：`probeWide` 按
 * `RELEVANCE_MIN` 量，而排除按更高的 `RELEVANCE_MIN_EXCLUDE` 判——
 * 量出来的宽根本不是它搜出来的宽。
 *
 * 成因落在 notices 上，不落在 chip 上：宽是**语料**的事实，会随语料换代失效，
 * 而 chips 是记录里不可变的那一半（论证在 `parse.ts` 的 Chip）。
 */
async function benchWide(
	evidence: string,
): Promise<{ evidence: string; notices: SearchNotice[] }> {
	const chips = parseChips(evidence);
	const admitting = chips.map((chip) => chip.mode !== "exclude" && !chip.off);
	const texts = [
		...new Set(
			chips.flatMap((chip, i) =>
				admitting[i] ? [chip.term, ...(chip.alts ?? [])] : [],
			),
		),
	];
	const wide = await probeWide(texts);
	if (wide.size === 0) return { evidence, notices: [] };

	let query = evidence;
	const notices: SearchNotice[] = [];
	chips.forEach((chip, index) => {
		if (!admitting[index]) return;
		if (![chip.term, ...(chip.alts ?? [])].some((text) => wide.has(text)))
			return;
		query = editChip(query, index, { off: true });
		notices.push({ kind: "wide", term: chip.term });
	});
	return { evidence: query, notices };
}

/**
 * 补全一次自然语言理解。delta 保存这句话自己的产物，spec 保存合并后的完整含义；
 * 并发更新通过 `spec is null` 保证先到者获胜，晚到者读回同一份最终结果。
 */
export async function resolveTurn(turnId: string): Promise<SearchSpec> {
	const row = await getRow(turnId);
	if (!row) throw new Error("查询记录不存在");
	if (row.spec) return row.spec;
	if (row.rawText === null) throw new Error("待理解记录缺少原话");
	const rawText = row.rawText;

	// 三段各自站在自己的那一代语料上，中间不押着门闩：词表是一次短读取，
	// 模型那一跳在门闩外（它可以慢到一分钟），量宽自己走一遍准入
	// （`search/phrases.ts` 的 withAdmission）。押着门闩等模型的话，一次理解
	// 就能把排在待发布 ETL 后面的每一个检索一起堵住。
	const vocab = await vocabulary();
	const understood = resolveIntent(
		rawText,
		await understand(rawText, vocab),
		vocab,
	);
	const benched = await benchWide(understood.evidence);
	const delta: SearchDelta = {
		...understood,
		evidence: benched.evidence,
		notices: [...understood.notices, ...benched.notices],
	};
	const spec = normalizeSpec(delta);

	await db
		.update(searchTurn)
		.set({ delta, spec })
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
