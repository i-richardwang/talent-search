/**
 * 把完整语料准备在连接私有的暂存表中，再原子发布到 Postgres。
 *
 * 表结构由 Drizzle 维护（`bun run db:push`），这里只负责整库幂等重灌。嵌入和
 * 校验发生在公开语料之外；只有最终发布会短暂挡住检索，因此端点延迟或失败不会
 * 让正在服务的语料变成空库，也不会让读者等待整轮嵌入。
 *
 * **模型调用一次都不在事务里。** 抽取、对齐、整理、嵌入全部跑在暂存之前的
 * autocommit 段；暂存是一批一批的短语句，发布是一笔只有本地 INSERT 的短事务。
 * 反过来把一次几十分钟的模型调用夹在事务里，独占锁会在 Postgres 里排队，
 * 一次端点抖动就挡住排在它后面的每一个读者（论证见 `src/db/index.ts`）。
 */

import "@tanstack/react-start/server-only";
import { EMBED_DIM, type Route } from "#/db/schema";
import { chatConfigured, chatEndpoint, extractModel } from "#/server/chat";
import { review } from "./aliases";
import { align } from "./align";
import { embed, probe, requireEmbedConfig } from "./embed";
import { EMPTY, type Extraction, extract } from "./extract";
import { build, type EmployeeRow, type ExperienceRow } from "./pipeline";
import type { Report } from "./report";
import { routeTexts } from "./route-texts";
import type { CorpusSession } from "./session";
import { loadSource } from "./sources";

/** 查询侧核对嵌入空间时重新嵌的那一串字。改它等于让所有已有语料的 canary 失效。 */
const CANARY_TEXT = "talent-search embedding canary";

/**
 * 一条语句写多少行。
 *
 * 说法那一批小得多：一行带一个一千多维的向量，字面量就有几千字符，几百行一批
 * 已经是几兆的语句。
 */
const ROWS_PER_STATEMENT = 5_000;
const PHRASE_ROWS_PER_STATEMENT = 500;

/** 一段经历指向一条说法的边。 */
type Link = {
	experienceId: number;
	route: Route;
	phraseId: number;
	involvement: string | null;
};

/**
 * 把经历行规划成稳定去重的说法和指向说法 id 的边。
 *
 * 抽取的两路和原文四路进同一张说法表：一个能力词恰好和某个岗位名是同一串字
 * 时只嵌一次，两条边各指向它。做过的事的说法是领域，参与方式落在边的第四列，
 * 其余路那一列是空。
 */
export function phrasePlan(
	rows: ExperienceRow[],
	extractions: Extraction[],
): { texts: string[]; links: Link[] } {
	const raw: {
		experienceId: number;
		route: Route;
		text: string;
		involvement: string | null;
	}[] = [];
	for (const [index, row] of rows.entries()) {
		const experienceId = index + 1;
		const extraction = extractions[index] ?? EMPTY;
		for (const [route, text] of routeTexts({
			kind: row.kind,
			org: row.org,
			orgPath: row.org_path,
			title: row.title,
			seqL1: row.seq_l1,
			seqL2: row.seq_l2,
			seqL3: row.seq_l3,
			description: row.description,
		}))
			raw.push({ experienceId, route, text, involvement: null });
		for (const skill of extraction.skills)
			raw.push({
				experienceId,
				route: "skill",
				text: skill,
				involvement: null,
			});
		for (const { involvement, domain } of extraction.did)
			raw.push({ experienceId, route: "did", text: domain, involvement });
	}

	const texts = [...new Set(raw.map((link) => link.text))];
	const idOf = new Map(texts.map((text, index) => [text, index + 1]));
	return {
		texts,
		links: raw.map((link) => ({
			experienceId: link.experienceId,
			route: link.route,
			phraseId: idOf.get(link.text) as number,
			involvement: link.involvement,
		})),
	};
}

/** 一段的抬头：前面空一行。日志是一行一条，换行不混在行里。 */
function section(report: Report, title: string) {
	report("");
	report(title);
}

function* chunked<T>(rows: T[], size: number): Generator<T[]> {
	for (let start = 0; start < rows.length; start += size)
		yield rows.slice(start, start + size);
}

async function createStagingTables({ client }: CorpusSession) {
	const tables: [string, string][] = [
		["staged_employee", "employee"],
		["staged_experience", "experience"],
		["staged_phrase", "phrase"],
		["staged_experience_phrase", "experience_phrase"],
	];
	for (const [staged, published] of tables)
		await client.query(
			`create temp table ${staged} (like ${published}) on commit preserve rows`,
		);
}

async function stageEmployee(
	{ client }: CorpusSession,
	rows: EmployeeRow[],
): Promise<void> {
	for (const chunk of chunked(rows, ROWS_PER_STATEMENT))
		await client.query(
			`insert into staged_employee (
				emp_id, name, cur_dept, cur_title, cur_seq_l1, cur_seq_l2, cur_seq_l3,
				cur_level, hire_date, education_level, school, recruitment)
			 select * from unnest(
				$1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
				$7::text[], $8::text[], $9::date[], $10::text[], $11::text[], $12::text[])`,
			[
				chunk.map((row) => row.emp_id),
				chunk.map((row) => row.name),
				chunk.map((row) => row.cur_dept),
				chunk.map((row) => row.cur_title),
				chunk.map((row) => row.cur_seq_l1),
				chunk.map((row) => row.cur_seq_l2),
				chunk.map((row) => row.cur_seq_l3),
				chunk.map((row) => row.cur_level),
				chunk.map((row) => row.hire_date),
				chunk.map((row) => row.education_level),
				chunk.map((row) => row.school),
				chunk.map((row) => row.recruitment),
			],
		);
}

async function stageExperience(
	{ client }: CorpusSession,
	rows: ExperienceRow[],
): Promise<void> {
	const withId = rows.map((row, index) => ({ id: index + 1, row }));
	for (const chunk of chunked(withId, ROWS_PER_STATEMENT))
		await client.query(
			`insert into staged_experience (
				id, emp_id, kind, start_date, end_date, org, org_path, org_meta, title,
				seq_l1, seq_l2, seq_l3, seq_inferred_l1, seq_inferred_l2, level,
				description, months)
			 select * from unnest(
				$1::int[], $2::text[], $3::text[], $4::date[], $5::date[], $6::text[],
				$7::text[], $8::jsonb[], $9::text[], $10::text[], $11::text[],
				$12::text[], $13::text[], $14::text[], $15::text[], $16::text[],
				$17::int[])`,
			[
				chunk.map((r) => r.id),
				chunk.map((r) => r.row.emp_id),
				chunk.map((r) => r.row.kind),
				chunk.map((r) => r.row.start_date),
				chunk.map((r) => r.row.end_date),
				chunk.map((r) => r.row.org),
				chunk.map((r) => r.row.org_path),
				chunk.map((r) => r.row.org_meta && JSON.stringify(r.row.org_meta)),
				chunk.map((r) => r.row.title),
				chunk.map((r) => r.row.seq_l1),
				chunk.map((r) => r.row.seq_l2),
				chunk.map((r) => r.row.seq_l3),
				chunk.map((r) => r.row.seq_inferred_l1),
				chunk.map((r) => r.row.seq_inferred_l2),
				chunk.map((r) => r.row.level),
				chunk.map((r) => r.row.description),
				chunk.map((r) => r.row.months),
			],
		);
}

async function stagePhrases(
	{ client }: CorpusSession,
	texts: string[],
	vectors: number[][],
): Promise<void> {
	const rows = texts.map((text, index) => {
		const vector = vectors[index];
		if (!vector) throw new Error(`说法没有向量：${text.slice(0, 40)}`);
		return { id: index + 1, text, embedding: `[${vector.join(",")}]` };
	});
	for (const chunk of chunked(rows, PHRASE_ROWS_PER_STATEMENT))
		await client.query(
			`insert into staged_phrase (id, text, embedding)
			 select * from unnest($1::int[], $2::text[], $3::halfvec[])`,
			[
				chunk.map((row) => row.id),
				chunk.map((row) => row.text),
				chunk.map((row) => row.embedding),
			],
		);
}

async function stageLinks(
	{ client }: CorpusSession,
	links: Link[],
): Promise<void> {
	for (const chunk of chunked(links, ROWS_PER_STATEMENT))
		await client.query(
			`insert into staged_experience_phrase (
				experience_id, route, phrase_id, involvement)
			 select * from unnest($1::int[], $2::text[], $3::int[], $4::text[])`,
			[
				chunk.map((link) => link.experienceId),
				chunk.map((link) => link.route),
				chunk.map((link) => link.phraseId),
				chunk.map((link) => link.involvement),
			],
		);
}

/**
 * 一笔短事务把整代语料换掉。
 *
 * 检索先锁 `embedding_space` 再读语料；发布沿用同一顺序，等待已有读者结束后
 * 一次替换完整代际，不会形成跨表锁环。
 */
async function publish(
	{ client }: CorpusSession,
	space: { spaceId: string; model: string },
	canary: number[],
	report: Report,
): Promise<void> {
	await client.query("begin");
	try {
		await client.query("lock table embedding_space in access exclusive mode");
		await client.query(
			"truncate experience, employee, phrase, embedding_space restart identity cascade",
		);
		const tables: [string, string, string][] = [
			[
				"employee",
				"staged_employee",
				"emp_id, name, cur_dept, cur_title, cur_seq_l1, cur_seq_l2, cur_seq_l3, cur_level, hire_date, education_level, school, recruitment",
			],
			[
				"experience",
				"staged_experience",
				"id, emp_id, kind, start_date, end_date, org, org_path, org_meta, title, seq_l1, seq_l2, seq_l3, seq_inferred_l1, seq_inferred_l2, level, description, months",
			],
			["phrase", "staged_phrase", "id, text, embedding"],
			[
				"experience_phrase",
				"staged_experience_phrase",
				"experience_id, route, phrase_id, involvement",
			],
		];
		for (const [published, staged, columns] of tables)
			await client.query(
				`insert into ${published} (${columns}) select ${columns} from ${staged}`,
			);

		// 暂存表里的 id 是自己编的，序列还停在 truncate 之后的起点上
		for (const table of ["experience", "phrase"])
			await client.query(
				`select setval(
					pg_get_serial_sequence('${table}', 'id')::regclass,
					coalesce((select max(id) from ${table}), 1),
					exists(select 1 from ${table}))`,
			);

		await client.query(
			`insert into embedding_space
				(space_id, model, dimension, canary_text, canary_embedding)
			 values ($1, $2, $3, $4, $5::halfvec)`,
			[
				space.spaceId,
				space.model,
				EMBED_DIM,
				CANARY_TEXT,
				`[${canary.join(",")}]`,
			],
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}

	const counts = await client.query<{ kind: string; n: string }>(
		"select kind, count(*) as n from experience group by kind order by 1",
	);
	const people = await client.query<{ n: string }>(
		"select count(*) as n from employee",
	);
	report(`  employee ${people.rows[0]?.n ?? 0} 行`);
	for (const row of counts.rows)
		report(`  experience[${row.kind}] ${row.n} 行`);
}

/**
 * 一次完整导入：读数据源 → 切段校验 → 抽取与对齐 → 嵌入 → 原子发布。
 *
 * 幂等，可反复跑。连接与串行化锁由调用方给（`corpus/session.ts`），
 * 说过的话交给 `report`（`src/server/import.ts` 让它同时进库和进标准输出）。
 */
export async function load(
	session: CorpusSession,
	sourceName: string,
	report: Report,
): Promise<void> {
	const space = requireEmbedConfig();

	report(`读取数据源 ${sourceName}…`);
	const source = await loadSource(sourceName);
	const data = await source.extract(report);

	section(report, "切段与校验…");
	const { employee, experience } = build(data, report);

	section(report, "探嵌入端点…");
	const canary = await probe(CANARY_TEXT);
	report(
		`  ${space.spaceId} · ${space.model} @ ${process.env.EMBED_BASE_URL}，${EMBED_DIM} 维`,
	);

	let staged = experience;
	let extractions: Extraction[] = experience.map(() => EMPTY);
	if (chatConfigured()) {
		section(report, `抽取端点 ${extractModel()} @ ${chatEndpoint()}`);
		section(report, "读简历描述…");
		extractions = await extract(staged, report);
		section(report, "整理能力词…");
		extractions = await review(
			session.client,
			extractions,
			staged.map((row) => row.emp_id),
			report,
		);
		section(report, "入职前经历对齐公司序列…");
		staged = await align(staged, report);
	} else {
		// 打印说明后跳过，不静默：检索仍然可用，但「为什么简历里写了却搜不到
		// 能力词」「为什么按序列筛不到入职前的经历」得有地方看见。
		section(
			report,
			"未配置抽取端点（EXTRACT_BASE_URL / EXTRACT_MODEL），" +
				"能力词与做过的事两路为空，入职前经历不对齐序列",
		);
	}

	section(report, "准备语料…");
	const { texts, links } = phrasePlan(staged, extractions);
	const vectors = await embed(texts, report);
	await createStagingTables(session);
	await stageEmployee(session, employee);
	await stageExperience(session, staged);
	await stagePhrases(session, texts, vectors);
	await stageLinks(session, links);

	section(report, "发布语料…");
	await publish(session, space, canary, report);
	const extracted = extractions.filter(
		(e) => e.skills.length > 0 || e.did.length > 0,
	).length;
	report(
		`  phrase ${texts.length} 行，experience_phrase ${links.length} 行，` +
			`其中 ${extracted} 段抽出了能力词或做过的事`,
	);
}
