/**
 * 数据目录的活统计：查询理解的 `discover` 工具和提示词里预先给的那一份。
 *
 * 只给人数和写法，不给人：有限取值的列给每个取值有多少人（和 `vocabulary()` 同一口径，
 * 空值与 `NOT_A_VALUE` 不算取值）；公司、部门、学校按名字包含匹配，和条件一样
 * （`search.ts` 的 `lookupNames`），写法至少有几个人写过才给，部门只给人数；记录流给覆盖
 * 的人数、期数和起止，不给任何一个人的记录。
 */
import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { withCorpusSnapshot } from "#/db/snapshot";
import { CATALOG, type CatalogRelation } from "#/search/catalog";
import { NOT_A_VALUE } from "#/search/dimensions";
import { lookupNames } from "#/search/search";
import type { Discovery, Matched, NameField, StreamFact } from "#/search/trace";
import { streamCoverage } from "./data";
import { catalogSchema } from "./sandbox";

/** 有高低的列按哪一列排。 */
const RANK_OF: Record<string, string> = {
	level_band: "level_rank",
	education: "education_rank",
	value: "value_rank",
};

/** 按名字匹配的列，对应 `lookupNames` 的哪一种。 */
const NAME_COLUMNS: Record<string, Record<string, NameField>> = {
	experience: { company: "company", department: "department" },
	person: { school: "school" },
};

/** 一列最多列几个取值，和词表同一个上限。 */
const VALUES_MAX = 100;

/** 每条记录流的覆盖与档位，提示词和 `discover` 的总览共用。 */
export async function streamFacts(): Promise<StreamFact[]> {
	const [coverage, scales] = await Promise.all([
		streamCoverage(),
		withCorpusSnapshot((store) =>
			store.execute<{ stream: string; values: string[] }>(sql`
				select stream, array_agg(value order by rank) as values
				from scale group by stream`),
		),
	]);
	const scaleOf = new Map(scales.rows.map((r) => [r.stream, r.values]));
	return coverage.map((c) => ({
		...c,
		scale: c.kind === "rating" ? (scaleOf.get(c.stream) ?? []) : [],
	}));
}

export type DiscoverInput = {
	relation?: string;
	column?: string;
	stream?: string;
	match?: string[];
};

/** 一问 → 一份回答。问不了的（没有这一列、这一列不能列取值）回一句原因。 */
export async function discover(input: DiscoverInput): Promise<Discovery> {
	if (!input.relation) return overview();
	const relation = CATALOG.find((r) => r.name === input.relation);
	if (!relation)
		return problem(
			`目录里没有 ${input.relation}；有 ${CATALOG.map((r) => r.name).join("、")}`,
		);
	const column = input.column;
	if (!column) return problem(`要说看 ${relation.name} 的哪一列`);
	const declared = (
		relation.columns as Record<string, CatalogRelation["columns"][string]>
	)[column];
	if (!declared) return problem(`${relation.name} 没有 ${column} 这一列`);
	// 线程里这一步的标题写给 HR：列的中文名，记录流写它的名字，不写目录里的英文名
	const subject = declared.label;
	const field = NAME_COLUMNS[relation.name]?.[column];
	if (field) {
		const names = (input.match ?? []).map((m) => m.trim()).filter(Boolean);
		if (names.length === 0)
			return problem(`${column} 按名字包含匹配：在 match 里写要找的名字`);
		return { kind: "names", subject, found: await lookupNames(field, names) };
	}
	if (!declared.values)
		return problem(
			`${column} 不是有限取值的列，不列取值；做过什么写进 terms，按意思找`,
		);
	const byStream = relation.name === "rating" || relation.name === "status";
	const stream = byStream ? input.stream : undefined;
	if (byStream && column === "value" && !stream)
		return problem("各条记录流的档不一样：在 stream 里写是哪一条流");
	const streamLabel = stream ? await labelOf(stream) : null;
	if (stream && !streamLabel) return problem(`没有 ${stream} 这条记录流`);
	return {
		kind: "values",
		subject: streamLabel ? `${streamLabel}的${subject}` : subject,
		values: await valuesOf(relation.name, column, stream),
	};
}

async function labelOf(stream: string): Promise<string | null> {
	const { rows } = await withCorpusSnapshot((store) =>
		store.execute<{ label: string }>(
			sql`select label from record_stream where stream = ${stream}`,
		),
	);
	return rows[0]?.label ?? null;
}

function problem(text: string): Discovery {
	return { kind: "problem", problem: text };
}

async function overview(): Promise<Discovery> {
	const schema = sql.identifier(catalogSchema());
	const [counts, streams] = await Promise.all([
		withCorpusSnapshot(async (store) => {
			const out: { name: string; label: string; rows: number }[] = [];
			for (const r of CATALOG) {
				const { rows } = await store.execute<{ n: number }>(
					sql`select count(*)::int as n from ${schema}.${sql.identifier(r.name)}`,
				);
				out.push({ name: r.name, label: r.label, rows: rows[0]?.n ?? 0 });
			}
			return out;
		}),
		streamFacts(),
	]);
	return { kind: "overview", relations: counts, streams };
}

async function valuesOf(
	relation: string,
	column: string,
	stream: string | undefined,
): Promise<Matched[]> {
	const schema = sql.identifier(catalogSchema());
	const col = sql.identifier(column);
	const rank = RANK_OF[column];
	return withCorpusSnapshot(async (store) => {
		const { rows } = await store.execute<Matched>(sql`
			select ${col}::text as name, count(distinct emp_id)::int as people
			from ${schema}.${sql.identifier(relation)}
			where ${col} is not null and ${col}::text not in (${sql.join(
				["", ...NOT_A_VALUE].map((v) => sql`${v}`),
				sql`, `,
			)}) ${stream ? sql`and stream = ${stream}` : sql``}
			group by 1
			order by ${rank ? sql`min(${sql.identifier(rank)}), ` : sql``}people desc, name
			limit ${VALUES_MAX}`);
		return rows;
	});
}
