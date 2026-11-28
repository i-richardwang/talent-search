/** 在已停写的数据库副本中升级保存的查询，保留条件编号、字面值、参数与原始排版。 */
import { loadModule, scanSync } from "libpg-query";
import type { PoolClient } from "pg";
import { corpusTransaction } from "#/corpus/session";
import { pool } from "#/db";
import type { SearchSpec } from "#/search/spec";

function personKeys(where: string) {
	const bytes = Buffer.from(where);
	const tokens = scanSync(where).tokens;
	const parts: Buffer[] = [];
	let offset = 0;
	for (const [i, t] of tokens.entries()) {
		if (t.tokenName !== "IDENT" || !/^(?:emp_id|"emp_id")$/i.test(t.text))
			continue;
		const prev = tokens[i - 1];
		if (prev?.text === ":" && prev.end === t.start) continue;
		parts.push(
			bytes.subarray(offset, t.start),
			Buffer.from(t.text.startsWith('"') ? '"person_id"' : "person_id"),
		);
		offset = t.end;
	}
	return offset
		? Buffer.concat([...parts, bytes.subarray(offset)]).toString()
		: where;
}

export async function upgradePersonQueries(c: PoolClient) {
	await loadModule();
	const { rows } = await c.query<{
		id: string;
		spec: Extract<SearchSpec, { query: unknown }>;
	}>(
		"select id,spec from search_turn where spec ? 'query' and (spec->'query'->'conditions')::text ~* 'emp_id' for update",
	);
	let changed = 0;
	for (const { id, spec } of rows) {
		let edited = false;
		for (const condition of spec.query.conditions) {
			const where = personKeys(condition.where);
			if (where === condition.where) continue;
			condition.where = where;
			edited = true;
		}
		if (edited) {
			await c.query("update search_turn set spec=$2 where id=$1", [id, spec]);
			changed++;
		}
	}
	return changed;
}

if (import.meta.main) {
	try {
		console.log(
			"已升级查询记录",
			await corpusTransaction(upgradePersonQueries),
		);
	} finally {
		await pool.end();
	}
}
