import type { SeqPair } from "#/corpus/align";
import { inputKeySql, prepareDeriveRequests } from "#/corpus/derive-requests";
import { deriveStandard } from "#/corpus/derive-standard";
import { type DeriveInput, extractionOf } from "#/corpus/extract";
import { collect, judged, type Question } from "#/corpus/judgment";
import type { Report } from "#/corpus/report";
import { guideIdentity } from "#/corpus/review-guide";
import { pool } from "#/db";
import { runCorpusAgent } from "#/server/corpus-agent";
import { ownerOf } from "./schema-name";

async function requireIsolatedCorpus() {
	const { rows } = await pool.query<{ schema: string }>(
		"select current_schema() as schema",
	);
	const schema = rows[0]?.schema ?? "";
	if (schema.endsWith("_catalog") || ownerOf(schema) !== process.pid)
		throw new Error("验收用例只能写入本进程的临时语料库");
}

/** 每次验收有自己的经历和请求，同一次验收库内可按模型与标准复用已保存的回答。 */
export async function experienceAnswers(
	kind: "extract" | "align",
	rows: DeriveInput[],
	tree: SeqPair[],
	report: Report,
) {
	await requireIsolatedCorpus();
	const client = await pool.connect();
	let standard: string;
	try {
		await client.query("begin");
		await client.query("delete from derive_request");
		await client.query("delete from person");
		await client.query("delete from sequence_catalog");
		await client.query(
			"insert into sequence_catalog select * from unnest($1::text[],$2::text[])",
			[tree.map((r) => r[0]), tree.map((r) => r[1])],
		);
		await client.query(
			"insert into person(person_id,name) select n::text,'验收样例' from generate_series(1,$1::int) n",
			[rows.length],
		);
		await client.query(
			`insert into experience(person_id,kind,unemployed,title,company,description,start_date,months)
			select n::text,r.kind,r.unemployed,r.title,r.company,r.description,date '2020-01-01',1
			from jsonb_array_elements($1::jsonb) with ordinality as v(item,n),
			lateral jsonb_to_record(v.item) as r(kind text,unemployed boolean,title text,company text,description text)`,
			[JSON.stringify(rows)],
		);
		const spec = await deriveStandard(client);
		if (spec.mode !== "model") throw new Error("经历验收需要配置抽取模型端点");
		await prepareDeriveRequests(client, spec);
		standard = spec[kind].standard;
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
	const pending = await pool.query(
		"select 1 from derive_request where standard=$1 and result is null and failed_version is null limit 1",
		[standard],
	);
	if (pending.rowCount) await runCorpusAgent(kind, report);
	const answers = await pool.query<{ result: unknown }>(
		`select q.result from experience e left join derive_request q on q.standard=$1 and q.input_key=${inputKeySql} order by e.person_id::int`,
		[standard],
	);
	return answers.rows.map((r) => r.result);
}

export async function evaluateExtraction(rows: DeriveInput[], report: Report) {
	const answers = await experienceAnswers("extract", rows, [], report);
	return rows.map((row, index) => extractionOf(row, answers[index]));
}

/** 同一写法在不同用例里可能有不同的参考词，各用例有独立的队列问题。 */
export async function evaluateReview(cases: Question[][], report: Report) {
	await requireIsolatedCorpus();
	const results: unknown[][] = [];
	const identity = guideIdentity();
	for (const questions of cases) {
		await pool.query("delete from review_word");
		await collect(pool, identity, questions);
		if (questions.length) await runCorpusAgent("review", report);
		const answers = new Map(
			(await judged(pool, identity)).map((row) => [row.word, row.judgment]),
		);
		results.push(questions.map((q) => answers.get(q.word)));
	}
	return results;
}
