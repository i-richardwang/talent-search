/**
 * 数据目录的活统计：查询理解的 `discover` 工具和提示词里预先给的那一份。
 *
 * 只给人数和写法，不给人：有限取值的列给每个取值有多少人（和词表同一条语句，`search.ts`
 * 的 `valuesOf`）；公司、部门、学校按名字包含匹配，和条件一样
 * （`search.ts` 的 `lookupNames`）；记录流给覆盖
 * 的人数、期数和起止，不给任何一个人的记录。
 */
import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { withCorpusSnapshot } from "#/db/snapshot";
import { CATALOG, catalogSchema, columnOf } from "#/search/catalog";
import type { NameField } from "#/search/condition-label";
import { lookupNames, valuesOf } from "#/search/search";
import type { CompanyFacts, Discovery, StreamFact } from "#/search/trace";
import { streamCoverage } from "./data";

/** 按名字匹配的列，对应 `lookupNames` 的哪一种。 */
const NAME_COLUMNS: Record<string, Record<string, NameField>> = {
	experience: { company: "company", department: "department" },
	person: { school: "school" },
};

/**
 * 每条记录流的覆盖与取值，提示词和 `discover` 的总览共用。评级流的取值是档位表里的档，
 * 从低到高；状态流的取值和看这条流的 `value` 列得到的是同一份，人多的在前。
 */
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
	return Promise.all(
		coverage.map(async (c) => ({
			...c,
			values:
				c.kind === "rating"
					? (scaleOf.get(c.stream) ?? [])
					: (
							await withCorpusSnapshot((store) =>
								valuesOf(store, "status", "value", c.stream),
							)
						).map((v) => v.name),
		})),
	);
}

/**
 * 入职前那些公司的概况。行业两列的人数和看这两列取值得到的是同一份（`valuesOf`），
 * 这里按行业树排好：上级在前，下级跟在它后面。
 */
export async function companyFacts(): Promise<CompanyFacts> {
	return withCorpusSnapshot(async (store) => {
		const view = sql`${sql.identifier(catalogSchema())}.experience`;
		const [tree, main, any, circles, natures, coverage] = [
			await store.execute<{ name: string; parent: string | null }>(
				sql`select name, parent from industry`,
			),
			await valuesOf(store, "experience", "main_industries"),
			await valuesOf(store, "experience", "industries"),
			await valuesOf(store, "experience", "company_circles"),
			await valuesOf(store, "experience", "company_nature"),
			await store.execute<{
				segments: number;
				recognized: number;
				labelled: number;
			}>(sql`
				select count(*)::int as segments,
					count(company_name)::int as recognized,
					count(industries)::int as labelled
				from ${view} where kind = 'external'`),
		];
		const peopleOf = (values: typeof main) =>
			new Map(values.map((v) => [v.name, v.people]));
		const mainOf = peopleOf(main);
		const anyOf = peopleOf(any);
		const children = new Map<string | null, string[]>();
		for (const row of tree.rows)
			children.set(row.parent, [...(children.get(row.parent) ?? []), row.name]);
		const ordered: CompanyFacts["industries"] = [];
		const visit = (parent: string | null) => {
			const names = (children.get(parent) ?? []).sort(
				(a, b) =>
					(anyOf.get(b) ?? 0) - (anyOf.get(a) ?? 0) ||
					a.localeCompare(b, "zh-Hans-CN"),
			);
			for (const name of names) {
				ordered.push({
					name,
					parent,
					main: mainOf.get(name) ?? 0,
					any: anyOf.get(name) ?? 0,
				});
				visit(name);
			}
		};
		visit(null);
		return {
			industries: ordered,
			circles,
			natures,
			segments: coverage.rows[0]?.segments ?? 0,
			recognized: coverage.rows[0]?.recognized ?? 0,
			labelled: coverage.rows[0]?.labelled ?? 0,
		};
	});
}

type DiscoverInput = {
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
	const declared = columnOf(relation.name, column);
	if (!declared) return problem(`${relation.name} 没有 ${column} 这一列`);
	// 线程里这一步的标题写给 HR：列的中文名，记录流写它的名字，不写目录里的英文名
	const subject = declared.label;
	const field = NAME_COLUMNS[relation.name]?.[column];
	if (field) {
		const names = input.match ?? [];
		if (names.length === 0)
			return problem(`${column} 按名字包含匹配：在 match 里写要找的名字`);
		return { kind: "names", subject, found: await lookupNames(field, names) };
	}
	if (!declared.values)
		return problem(
			`${column} 不是有限取值的列，不列取值；做过什么写进 seek，按字面捞说法`,
		);
	const byStream = relation.name === "rating" || relation.name === "status";
	const stream = byStream ? input.stream : undefined;
	if (byStream && column === "value" && !stream)
		return problem("各条记录流的取值不一样：在 stream 里写是哪一条流");
	const streamLabel = stream ? await labelOf(stream) : null;
	if (stream && !streamLabel) return problem(`没有 ${stream} 这条记录流`);
	return {
		kind: "values",
		subject: streamLabel ? `${streamLabel}的${subject}` : subject,
		values: await withCorpusSnapshot((store) =>
			valuesOf(store, relation.name, column, stream),
		),
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
			// 各视图的行数在一条语句里数完，每个视图一列
			const { rows } = await store.execute<Record<string, number>>(
				sql`select ${sql.join(
					CATALOG.map(
						(r, i) =>
							sql`(select count(*)::int from ${schema}.${sql.identifier(r.name)}) as ${sql.identifier(`n${i}`)}`,
					),
					sql`, `,
				)}`,
			);
			return CATALOG.map((r, i) => ({
				name: r.name,
				label: r.label,
				rows: rows[0]?.[`n${i}`] ?? 0,
			}));
		}),
		streamFacts(),
	]);
	return { kind: "overview", relations: counts, streams };
}
