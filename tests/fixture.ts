/**
 * 检索的集成测试跑在一个临时 schema 上：真 Postgres、真 SQL、真 pgvector，
 * 但不碰人才库，也不碰真的嵌入模型。
 *
 * 建表语句由 schema.ts 现场推导，不手抄——加一列而忘了同步测试夹具这件事，
 * 在这里不可能发生。索引一概不建：夹具只有十几行，全表扫比建索引快，
 * 而索引不参与被测的语义。
 *
 * **三个模型端点由一个进程内的假端点提供。** 嵌入按字符袋算向量（见
 * `fakeEmbedding`），重排分数就是同一个余弦，于是相关度是可以手算的——「算法」对
 * 「算法工程师」是 2/√(2×5) ≈ 0.63，对「运营」是 0。召回下限不高于判定线
 * （`RECALL_MIN <= RELEVANCE_MIN`，search.test.ts 有断言），所以在这里通过的阈值就是
 * `RELEVANCE_MIN` 一个数。查询理解按一行查询语法读那句话（见 `fakeIntent`），
 * 于是一句「算法, -实习」得到的条件是可以预先写出来的。测试用它们测**机制**
 * （阈值、AND、否决、分面、记录派生），不测语义质量；语义质量归 eval 和真模型。
 * 查询侧走的是真正的 HTTP 客户端代码（`src/server/embed.ts`、`src/server/rerank.ts`、
 * `src/server/llm.ts`），只有对面那台机器是假的。
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { phrasesOf } from "#/corpus/route-texts";
import {
	completionCache,
	EMBED_DIM,
	embeddingCache,
	embeddingSpace,
	employee,
	experience,
	experiencePhrase,
	phrase,
	phraseGloss,
	phraseRelevance,
	reviewGroup,
	searchTurn,
	skillTerm,
	taskRun,
} from "#/db/schema";
import type { Involvement } from "#/lib/involvement";
import { parseQuery } from "#/search/query-syntax";

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
		if (c.generated) {
			// 库自己算的列（experience.key）。表达式是 SQL 或字符串，照 drizzle 的形态取
			const as =
				typeof c.generated.as === "function"
					? c.generated.as()
					: c.generated.as;
			const expression =
				typeof as === "string" ? as : dialect.sqlToQuery(as as SQL).sql;
			parts.push(`generated always as (${expression}) stored`);
		}
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

/**
 * 假理解：把那句话按一行查询语法读（`search/query-syntax.ts`），交出真模型
 * 会交出的那份查询。模型说的和库里存的是同一个形状（`intentSchema` 就是
 * `Condition[]`），所以这里不必翻译；词表检查在 intent.test.ts 里对着 `toSpec` 直接测。
 * 一行语法里的 `~` 会带出 `off`，而真模型从不写停用，去掉。
 */
function fakeIntent(text: string) {
	return {
		conditions: parseQuery(text).map(({ off: _off, ...rest }) => rest),
	};
}

/** 那句话在提示词里的位置，和 `src/server/llm.ts` 的 `understand` 写的一致。 */
const SENTENCE_PREFIX = "这句话：";

/**
 * 语料侧那三处聊天调用（抽取、对齐、整理）的假回答。
 *
 * 查询理解认得出自己的提示词（那句话前面有 `SENTENCE_PREFIX`），剩下的都是语料侧
 * 的。它们的回答不像查询理解那样能从输入算出来——「这段描述里有哪些能力词」本来
 * 就是判断——所以由测试自己给，顺便把问过什么收下来断言。
 */
let chatAnswer: ((system: string, prompt: string) => unknown) | null = null;

/** 装一份语料侧聊天端点的回答，返回拆掉它的函数。 */
export function answerChat(
	fn: (system: string, prompt: string) => unknown,
): () => void {
	chatAnswer = fn;
	return () => {
		chatAnswer = null;
	};
}

let intentBroken = false;
let intentAnswer: ((text: string) => unknown) | null = null;

/**
 * 换一份查询理解的回答，返回拆掉它的函数。默认那份按一行查询语法作答，永远合规；
 * 要测「模型说的话不合规」那条路，就得让它说别的。
 */
export function answerIntent(fn: (text: string) => unknown): () => void {
	intentAnswer = fn;
	return () => {
		intentAnswer = null;
	};
}

/**
 * 让查询理解端点以 500 失败，直到调用返回的恢复函数为止。按「次」失败不够：
 * 客户端会重试一次，第二次成功就看不到失败的那条路了。
 */
export function breakUnderstanding(): () => void {
	intentBroken = true;
	return () => {
		intentBroken = false;
	};
}

/**
 * OpenAI 兼容的 `/embeddings` 与 `/chat/completions`，加上 Cohere 式的
 * `/rerank`，只认这三个路径。
 */
function startModelServer() {
	const server = createServer((req, res) => {
		if (
			req.method !== "POST" ||
			!["/embeddings", "/rerank", "/chat/completions"].includes(req.url ?? "")
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
			if (req.url === "/chat/completions") {
				if (intentBroken) {
					res.writeHead(500).end("假模型按要求失败");
					return;
				}
				const { messages } = JSON.parse(body) as {
					messages: { role: string; content: string }[];
				};
				const prompt = messages
					.filter((m) => m.role === "user")
					.at(-1)?.content;
				const at = prompt?.lastIndexOf(SENTENCE_PREFIX) ?? -1;
				const system = messages.find((m) => m.role === "system")?.content ?? "";
				const content =
					prompt === undefined
						? undefined
						: at >= 0
							? JSON.stringify(
									(intentAnswer ?? fakeIntent)(
										prompt.slice(at + SENTENCE_PREFIX.length),
									),
								)
							: chatAnswer
								? JSON.stringify(await chatAnswer(system, prompt))
								: undefined;
				if (content === undefined) {
					res.writeHead(400).end("没有人认领这份提示词");
					return;
				}
				json({
					id: "fake",
					object: "chat.completion",
					created: 0,
					model: "fake",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content },
							finish_reason: "stop",
						},
					],
					usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
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
 * 建好临时 schema、起好假模型端点，把 DATABASE_URL / EMBED_* / RERANK_* / LLM_*
 * 指过去，然后才 import 检索模块。
 *
 * `#/db`、`#/server/embed`、`#/server/rerank`、`#/server/llm` 都是模块级单例，一旦 import 就绑死了环境变量——
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
		phraseGloss,
		searchTurn,
		skillTerm,
		reviewGroup,
		embeddingCache,
		completionCache,
		taskRun,
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
	process.env.LLM_BASE_URL = modelServer.url;
	process.env.LLM_MODEL = "fake";
	process.env.LLM_STRUCTURED_OUTPUTS = "true";
	// 语料侧那三处聊天调用也指向同一台假端点，回答由 `answerChat` 装
	process.env.EXTRACT_BASE_URL = modelServer.url;
	process.env.EXTRACT_MODEL = "fake";
	process.env.EXTRACT_STRUCTURED_OUTPUTS = "true";
	process.env.REVIEW_MODEL = "review-fake";
	// 判定归自带模型：外部那条路由测它的用例自己开
	process.env.REVIEW_JUDGE = "model";
	delete process.env.REVIEW_TOKEN;
	process.env.EXTRACT_CONCURRENCY = "2";
	process.env.TALENT_SOURCE = "csv-dir";
	process.env.TALENT_CSV_DIR = "";

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
 * 「这次写入被哪条约束拒绝了」。
 *
 * 认的是 Postgres 报回来的**约束名**，不是错误文案里恰好出现了那几个字：
 * 文案里能出现约束名的错有好几种（比如提到同一张表的另一条约束），认串就会
 * 出现「拦是拦住了，但不是被这一条拦住的」而测试照样通过。
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
		/** 入职前的段由模型对齐的序列（真语料里由 src/corpus/align.ts 写；夹具直接给）。 */
		seqInferredL1?: string;
		seqInferredL2?: string;
		description?: string;
		companyTag?: string;
		/**
		 * 这一段的抽取结果，真语料里由 src/corpus/extract.ts 从 description 读出来；
		 * 夹具直接给。给了（哪怕是空的）就是「读过」，自述证据只有它；不给就是
		 * 「没读过」，整段 description 当说法（`corpus/route-texts.ts`）。
		 */
		extracted?: {
			skills?: string[];
			/** 领域是说法，参与方式落在边上（真语料里由 conform 收窄取值）。 */
			did?: { involvement: Involvement; domain: string }[];
		};
	}>;
};

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
						seqInferredL1: s.seqInferredL1 ?? "",
						seqInferredL2: s.seqInferredL2 ?? "",
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
	// 说法去重后各嵌一次，经历段按路指向它们——拼法和 src/corpus/derive.ts 是
	// 同一个函数。抽取结果夹具直接给：seed 的入参和 inserted 顺序一致，按下标对回去。
	const specs = rows.flatMap((r) => r.segments);
	const links = inserted.flatMap((s, i) => {
		const extracted = specs[i]?.extracted;
		return phrasesOf(
			s,
			extracted
				? { skills: extracted.skills ?? [], did: extracted.did ?? [] }
				: null,
		).map((p) => ({ experienceId: s.id, ...p }));
	});
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
			involvement: l.involvement,
		})),
	);
}
