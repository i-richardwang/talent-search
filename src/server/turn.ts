/** 查询记录的持久化与派生规则。记录不可变；唯一更新是补全待理解记录。 */
import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import type { SearchTurn } from "#/db/schema";
import { searchTurn } from "#/db/schema";
import { resolveIntent } from "#/search/intent";
import type { Chip } from "#/search/parse";
import { probeWide, vocabulary } from "#/search/search";
import {
	emptySpec,
	fellBack,
	mergeSpec,
	type QueryInput,
	type SearchDelta,
	type SearchSpec,
} from "#/search/spec";
import { type Correction, understand } from "./llm";

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

async function insertTurn(row: {
	parent: SearchTurn | null;
	rawText: string | null;
	delta?: SearchDelta | null;
	spec?: SearchSpec | null;
	baseTurnId?: string | null;
	note?: string | null;
}): Promise<Turn> {
	const id = newId();
	const [inserted] = await db
		.insert(searchTurn)
		.values({
			id,
			rootTurnId: row.parent ? row.parent.rootTurnId : id,
			parentTurnId: row.parent?.id ?? null,
			baseTurnId: row.baseTurnId ?? null,
			rawText: row.rawText,
			note: row.note ?? null,
			delta: row.delta ?? null,
			spec: row.spec ?? null,
		})
		.returning();
	if (!inserted) throw new Error("写入查询记录失败");
	return toTurn(inserted);
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

	let turn: Turn;
	if (input.kind === "reinterpret") {
		if (!parent?.rawText || !parent.delta)
			throw new Error("重新理解需要一条由整句产生的父记录");
		if (!input.note && !fellBack(parent.delta))
			throw new Error("这条理解没有降级，重新理解需要附带纠正说明");
		turn = await insertTurn({
			parent,
			baseTurnId: parent.baseTurnId,
			rawText: parent.rawText,
			note: input.note ?? null,
		});
	} else if (input.kind === "sentence") {
		turn = await insertTurn({
			parent,
			baseTurnId: parent?.id ?? null,
			rawText: input.text,
		});
	} else {
		turn = await insertTurn({ parent, rawText: null, spec: input.spec });
	}
	return { turnId: turn.id };
}

/** 量宽只作用于新句产生的证据，不改写基线中用户已经确认过的状态。 */
async function benchWide(evidence: Chip[]): Promise<Chip[]> {
	const texts = [
		...new Set(evidence.flatMap((item) => [item.term, ...(item.alts ?? [])])),
	];
	const wide = await probeWide(texts);
	if (wide.size === 0) return evidence;
	return evidence.map((item) =>
		[item.term, ...(item.alts ?? [])].some((term) => wide.has(term))
			? { ...item, off: true as const, wide: true as const }
			: item,
	);
}

/**
 * 补全一次自然语言理解。delta 保存这句话自己的产物，spec 保存合并后的完整含义；
 * 并发更新通过 `spec is null` 保证先到者获胜，晚到者读回同一份最终结果。
 */
export async function resolveTurn(turnId: string): Promise<SearchSpec> {
	const row = await getRow(turnId);
	if (!row) throw new Error("查询记录不存在");
	if (row.spec) return row.spec;

	const vocab = await vocabulary();
	const base = row.baseTurnId ? await getRow(row.baseTurnId) : null;
	let correction: Correction | undefined;
	if (row.note) {
		const parent = row.parentTurnId ? await getRow(row.parentTurnId) : null;
		if (parent?.delta) {
			correction = {
				previous: parent.delta,
				note: row.note,
			};
		}
	}

	const understood = resolveIntent(
		row.rawText ?? "",
		await understand(row.rawText ?? "", vocab, correction),
		vocab,
	);
	const delta: SearchDelta = {
		...understood,
		evidence: await benchWide(understood.evidence),
	};
	const spec = mergeSpec(base?.spec ?? emptySpec(), delta);

	await db
		.update(searchTurn)
		.set({ delta, spec })
		.where(and(eq(searchTurn.id, row.id), isNull(searchTurn.spec)));

	return (await getRow(row.id))?.spec ?? spec;
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
	createdAt: string;
};

/** 每条派生链只展示最后一份完整查询；打开 turnId 即可精确回放全部条件。 */
export async function listRecent(): Promise<RecentSearch[]> {
	const rows = await db.execute<{
		id: string;
		spec: SearchSpec;
		created_at: Date;
		root_raw_text: string | null;
	}>(sql`
			select latest.id, latest.spec, latest.created_at,
				root.raw_text as root_raw_text
			from (
				select distinct on (root_turn_id) id, root_turn_id, spec, created_at
				from search_turn where spec is not null
				order by root_turn_id, created_at desc
			) latest
			join search_turn root on root.id = latest.root_turn_id
			order by latest.created_at desc
			limit ${RECENT_MAX}`);
	return rows.rows.map((row) => ({
		turnId: row.id,
		spec: row.spec,
		rawText: row.root_raw_text,
		createdAt: new Date(row.created_at).toISOString(),
	}));
}
