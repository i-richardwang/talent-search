/**
 * 检索的集成测试跑在一个临时 schema 上：真 Postgres、真 SQL、真 pgvector，
 * 但不碰人才库，也不碰真的嵌入模型。
 *
 * 建表语句由 schema.ts 现场推导，不手抄——加一列而忘了同步测试夹具这件事，
 * 在这里不可能发生。索引一概不建：夹具只有十几行，全表扫比建索引快，
 * 而索引不参与被测的语义。
 *
 * **嵌入和重排由一个进程内的假端点提供**（见 `fakeEmbedding`）：它按字符袋算
 * 向量，重排分数就是同一个余弦，于是相关度是可以手算的——「算法」对
 * 「算法工程师」是 2/√(2×5) ≈ 0.63，对「运营」是 0。召回地板不高于判定线
 * （`RECALL_MIN <= RELEVANCE_MIN`，search.test.ts 钉着），所以在这里进门线就是
 * `RELEVANCE_MIN` 一个数。测试用它钉**机制**（阈值、AND、否决、分面），不钉
 * 语义质量；语义质量归 eval 和真模型。查询侧走的是真正的 HTTP 客户端代码
 * （`src/server/embed.ts`、`src/server/rerank.ts`），只有对面那台机器是假的。
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import {
	EMBED_DIM,
	embeddingSpace,
	employee,
	experience,
	experiencePhrase,
	phrase,
	phraseRelevance,
	type Route,
	searchTurn,
} from "#/db/schema";

/**
 * 每个测试文件一个 schema。名字带进程号**和**一段随机：`bun test --parallel`
 * 只隔离模块注册表与环境变量，几个文件会落在同一个 worker 进程上，光靠进程号
 * 两个文件就会抢同一个 schema——后建的那个 `drop ... cascade` 会把前一个正在
 * 用的表整片删掉，症状是另一个文件里毫不相干的一条断言报「表不存在」。
 */
const SCHEMA = `talent_test_${process.pid}_${randomBytes(4).toString("hex")}`;

function ddl(schema: string, table: PgTable) {
	const { name, columns, checks, foreignKeys, uniqueConstraints, primaryKeys } =
		getTableConfig(table);
	const dialect = new PgDialect();
	const cols = columns.map((c) => {
		const parts = [`"${c.name}"`, c.getSQLType()];
		if (c.primary) parts.push("primary key");
		// 约束名照 drizzle 的默认（`<表>_<列>_unique`），测试才能按名字认出它
		if (c.isUnique)
			parts.push(
				`constraint "${c.uniqueName ?? `${name}_${c.name}_unique`}" unique`,
			);
		if (c.notNull && !c.primary) parts.push("not null");
		if (c.default !== undefined) {
			// 三种形态：字符串字面量、SQL 表达式（defaultNow）、jsonb 的对象默认值
			const d =
				typeof c.default === "string"
					? `'${c.default}'`
					: typeof c.default === "object" && c.default !== null
						? "queryChunks" in c.default
							? dialect.sqlToQuery(c.default as SQL).sql
							: `'${JSON.stringify(c.default)}'`
						: c.default;
			parts.push(`default ${d}`);
		}
		return parts.join(" ");
	});
	const constraints = checks.map((c) => {
		const expression = dialect
			.sqlToQuery(c.value)
			.sql.replaceAll(`"${name}".`, "");
		return `constraint "${c.name}" check (${expression})`;
	});
	for (const pk of primaryKeys) {
		const cols = pk.columns.map((c) => `"${c.name}"`).join(", ");
		constraints.push(`primary key (${cols})`);
	}
	// 表级 unique（列上那些由 `c.isUnique` 建）
	for (const u of uniqueConstraints) {
		const cols = u.columns.map((c) => `"${c.name}"`).join(", ");
		constraints.push(`constraint "${u.name}" unique (${cols})`);
	}
	for (const foreignKey of foreignKeys) {
		const reference = foreignKey.reference();
		const foreignName = getTableConfig(reference.foreignTable).name;
		const local = reference.columns
			.map((column) => `"${column.name}"`)
			.join(", ");
		const foreign = reference.foreignColumns
			.map((column) => `"${column.name}"`)
			.join(", ");
		constraints.push(
			`constraint "${foreignKey.getName()}" foreign key (${local}) references ${schema}."${foreignName}" (${foreign}) on delete ${foreignKey.onDelete}`,
		);
	}
	return `create table ${schema}."${name}" (${[...cols, ...constraints].join(", ")})`;
}

/**
 * 假嵌入：字符袋。每个字占一个维度（按出现顺序分配），向量归一化，
 * 所以两串字的余弦 = 共有字数 / √(字数 × 字数)。同一进程里种子与查询共用
 * 这张表，两边的向量自然可比。
 */
const charDims = new Map<string, number>();
export function fakeEmbedding(text: string): number[] {
	const v = new Array<number>(EMBED_DIM).fill(0);
	for (const ch of text) {
		// 只数字和字母：分隔符（「 · 」「/」）不是内容，数进去会稀释相似度
		if (!/[\p{L}\p{N}]/u.test(ch)) continue;
		let dim = charDims.get(ch);
		if (dim === undefined) {
			dim = charDims.size;
			if (dim >= EMBED_DIM) throw new Error("假嵌入的字符表用满了");
			charDims.set(ch, dim);
		}
		v[dim] = (v[dim] ?? 0) + 1;
	}
	const norm = Math.hypot(...v) || 1;
	return v.map((x) => x / norm);
}

/**
 * 语料侧写进 `embedding_space` 的 canary 原文。查询侧首次嵌入前会重嵌它核对
 * 端点还在同一个空间里，所以测试模拟一次发布时也得原样写回这一串。
 */
export const CANARY = "talent-search embedding canary";

/** 两串字在假嵌入下的余弦，测试里用来解释断言的边界。 */
export function fakeSimilarity(a: string, b: string) {
	const va = fakeEmbedding(a);
	const vb = fakeEmbedding(b);
	const similarity = va.reduce((s, x, i) => s + x * (vb[i] ?? 0), 0);
	return Math.min(1, Math.max(0, similarity));
}

type RerankGate = {
	enter: () => void;
	wait: Promise<void>;
};

let nextRerankGate: RerankGate | null = null;

/** 暂停下一次重排请求，用来观察检索事务进行到模型调用期间的数据库状态。 */
export function holdNextRerank() {
	if (nextRerankGate) throw new Error("已经有一条重排请求在等待");
	let enter = () => {};
	let release = () => {};
	const entered = new Promise<void>((resolve) => {
		enter = resolve;
	});
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	nextRerankGate = { enter, wait };
	return { entered, release };
}

/** OpenAI 兼容的 `/embeddings` 与 Cohere 式的 `/rerank`，只认这两个路径。 */
function startModelServer() {
	const server = createServer((req, res) => {
		if (
			req.method !== "POST" ||
			!["/embeddings", "/rerank"].includes(req.url ?? "")
		) {
			res.writeHead(404).end();
			return;
		}
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", async () => {
			const json = (payload: unknown) =>
				res
					.writeHead(200, { "content-type": "application/json" })
					.end(JSON.stringify(payload));
			if (req.url === "/rerank") {
				const gate = nextRerankGate;
				nextRerankGate = null;
				if (gate) {
					gate.enter();
					await gate.wait;
				}
				const { query, documents } = JSON.parse(body) as {
					query: string;
					documents: string[];
				};
				json({
					results: documents.map((d, index) => ({
						index,
						relevance_score: fakeSimilarity(query, d),
					})),
				});
				return;
			}
			const { input } = JSON.parse(body) as { input: string | string[] };
			const texts = Array.isArray(input) ? input : [input];
			json({
				object: "list",
				model: "fake",
				data: texts.map((t, index) => ({
					object: "embedding",
					index,
					embedding: fakeEmbedding(t),
				})),
				usage: { prompt_tokens: 0, total_tokens: 0 },
			});
		});
	});
	return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			resolve({
				url: `http://127.0.0.1:${port}`,
				close: () =>
					new Promise((done) => {
						// close() 只停止接客并关空闲连接；查询侧 fetch 池里的 keep-alive
						// 连接要靠 closeAllConnections() 一并掐断。Node 文档要求它在
						// close() 之后调用，否则有竞争。
						server.close(() => done());
						server.closeAllConnections();
					}),
			});
		});
	});
}

/**
 * 建好临时 schema、起好假模型端点，把 DATABASE_URL / EMBED_* / RERANK_* 指过去，
 * 然后才 import 检索模块。
 *
 * `#/db`、`#/server/embed`、`#/server/rerank` 都是模块级单例，一旦 import 就绑死了环境变量——
 * 所以顺序不能反，调用方必须 `await setup()` 之后再动态 import 被测代码。
 *
 * `bun test --parallel` 给每个文件一份独立的模块注册表与环境变量，所以单例这一条
 * 逐文件成立；但**进程是共用的**，schema 名因此不能只靠进程号区分（见 `SCHEMA`）。
 */
export async function setup() {
	const base = process.env.DATABASE_URL;
	if (!base)
		throw new Error(
			"DATABASE_URL 未配置，集成测试需要一个装了 pgvector 的本地 Postgres",
		);

	const admin = new Pool({ connectionString: base });
	await admin.query("create extension if not exists vector");
	await admin.query(`drop schema if exists ${SCHEMA} cascade`);
	await admin.query(`create schema ${SCHEMA}`);
	for (const t of [
		employee,
		experience,
		embeddingSpace,
		phrase,
		experiencePhrase,
		phraseRelevance,
		searchTurn,
	])
		await admin.query(ddl(SCHEMA, t));
	await admin.query(
		`insert into ${SCHEMA}.embedding_space
			(space_id, model, dimension, canary_text, canary_embedding)
		 values ($1, $2, $3, $4, $5::halfvec)`,
		[
			"fake-v1",
			"fake",
			EMBED_DIM,
			CANARY,
			`[${fakeEmbedding(CANARY).join(",")}]`,
		],
	);
	await admin.end();

	const url = new URL(base);
	url.searchParams.set("options", `-c search_path=${SCHEMA},public`);
	process.env.DATABASE_URL = url.toString();

	const modelServer = await startModelServer();
	process.env.EMBED_BASE_URL = modelServer.url;
	process.env.EMBED_MODEL = "fake";
	process.env.EMBED_SPACE_ID = "fake-v1";
	process.env.RERANK_MODEL = "fake";
	process.env.RERANK_SPACE_ID = "fake-v1";

	return async function teardown() {
		const { pool } = await import("#/db");
		await pool.end();
		await modelServer.close();
		const a = new Pool({ connectionString: base });
		await a.query(`drop schema if exists ${SCHEMA} cascade`);
		await a.end();
	};
}

/**
 * 「这次写入被哪条约束拦下了」。
 *
 * 认的是 Postgres 报回来的**约束名**，不是错误文案里恰好出现了那几个字：
 * 文案里能出现约束名的错有好几种（比如提到同一张表的另一条约束），认串就会
 * 出现「拦是拦住了，但不是被这一条拦住的」而测试照样绿。
 */
export const violates = (constraint: string) => (error: unknown) =>
	(error as { cause?: { constraint?: string } }).cause?.constraint ===
	constraint;

/** 一个人 + 他的若干段经历。字段用默认值兜底，测试里只写与断言相关的那几个。 */
export type Seed = {
	empId: string;
	name: string;
	curLevel?: string;
	recruitment?: string;
	education?: string;
	school?: string;
	segments: Array<{
		kind?: "internal" | "external";
		months: number;
		/** 省略表示至今。近因因子看的就是它。 */
		endDate?: string;
		org?: string;
		orgPath?: string;
		title?: string;
		seqL1?: string;
		seqL2?: string;
		description?: string;
		companyTag?: string;
	}>;
};

/**
 * 四路原文的拼法。语料侧的那一份是 `etl/embed.py` 的 `route_texts`——跨语言，
 * 这边调不到它，于是两侧各自对同一份契约求值：`etl/route_texts.contract.json`。
 * 改拼法就是改那份契约，改完两边一起红（`tests/route-texts.test.ts` 与
 * `etl/test_embed.py` 各钉一头），不靠「记得同步」。
 */
export function routeTexts(s: {
	kind: "internal" | "external";
	org: string;
	orgPath: string;
	title: string;
	seqL1: string;
	seqL2: string;
	seqL3: string;
	description: string;
}) {
	const seq = [s.seqL1, s.seqL2, s.seqL3].filter(Boolean).join(" · ");
	const org = s.kind === "internal" && s.orgPath ? s.orgPath : s.org;
	return Object.entries({
		seq,
		title: s.title,
		org,
		description: s.description,
	}).filter(([, text]) => text) as [Route, string][];
}

export async function seed(rows: Seed[]) {
	const { db } = await import("#/db");
	const {
		employee: emp,
		experience: exp,
		phrase: ph,
		experiencePhrase: ep,
	} = await import("#/db/schema");
	await db.insert(emp).values(
		rows.map((r) => ({
			empId: r.empId,
			name: r.name,
			curLevel: r.curLevel ?? "",
			recruitment: r.recruitment ?? "",
			educationLevel: r.education ?? "",
			school: r.school ?? "",
		})),
	);
	let day = 1;
	const inserted = await db
		.insert(exp)
		.values(
			rows.flatMap((r) =>
				r.segments.map((s) => {
					// 起始日只要自洽即可：打分看的是 months 与 endDate，不看它
					const start = `20${String(10 + (day++ % 80)).padStart(2, "0")}-01-01`;
					return {
						empId: r.empId,
						kind: s.kind ?? "internal",
						startDate: start,
						endDate: s.endDate ?? null,
						org: s.org ?? "",
						orgPath: s.orgPath ?? "",
						title: s.title ?? "",
						seqL1: s.seqL1 ?? "",
						seqL2: s.seqL2 ?? "",
						description: s.description ?? "",
						months: s.months,
						orgMeta: s.companyTag
							? {
									company_tag: s.companyTag,
									industry: "",
									nature: "",
								}
							: null,
					};
				}),
			),
		)
		.returning();
	// 说法去重后各嵌一次，经历段按路指向它们——和 etl/load.py 同一个形状
	const links = inserted.flatMap((s) =>
		routeTexts({ ...s, seqL3: s.seqL3 }).map(([route, text]) => ({
			experienceId: s.id,
			route,
			text,
		})),
	);
	const texts = [...new Set(links.map((l) => l.text))];
	if (texts.length === 0) return;
	const phrases = await db
		.insert(ph)
		.values(texts.map((text) => ({ text, embedding: fakeEmbedding(text) })))
		.onConflictDoNothing()
		.returning({ id: ph.id, text: ph.text });
	const existing = await db.select({ id: ph.id, text: ph.text }).from(ph);
	const idOf = new Map([...phrases, ...existing].map((p) => [p.text, p.id]));
	await db.insert(ep).values(
		links.map((l) => ({
			experienceId: l.experienceId,
			route: l.route,
			phraseId: idOf.get(l.text) as number,
		})),
	);
}
