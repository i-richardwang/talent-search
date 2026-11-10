/**
 * 集成测试使用临时 schema、真实 PostgreSQL/pgvector 和进程内合成模型端点。
 * 表结构由 schema.ts 推导；不创建索引。字符袋嵌入、余弦重排与查询语法理解用于验证机制，
 * 真实模型的语义质量由 eval 验收。测试运行不读取真实人才数据或模型密钥。
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { SQL } from "drizzle-orm";
import {
	getTableConfig,
	getViewConfig,
	PgDialect,
	type PgTable,
} from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { phrasesOf } from "#/corpus/route-texts";
import {
	authAccount,
	authSession,
	authUser,
	authVerification,
	CATALOG_VIEWS,
	company,
	companyAlias,
	completionCache,
	EMBED_DIM,
	embeddingCache,
	embeddingSpace,
	employee,
	employeeRecord,
	experience,
	experienceNext,
	experiencePhrase,
	experiencePhraseNext,
	industry,
	phrase,
	phraseGloss,
	recordStream,
	rerankCache,
	reviewGroup,
	scale,
	searchTurn,
	taskRun,
	term,
} from "#/db/schema";
import type { Engagement } from "#/lib/engagement";
import { compileConditions } from "#/search/compile";
import { parseQuery } from "#/search/query-syntax";

/**
 * 每个测试文件使用进程号和随机值组成的临时 schema。
 * bun test --parallel 隔离模块与环境，但多个文件可共用同一 worker 进程。
 */
const SCHEMA = `talent_test_${process.pid}_${randomBytes(4).toString("hex")}`;

/** 这个测试文件的数据目录（`schema.ts` 的 `catalog`）：视图建在这里，指向本文件的表。 */
const CATALOG = `${SCHEMA}_catalog`;

/** Postgres 把更长的名字静默截短；截短后和 schema 里的名字对不上，db:push 每次都会删了重建。 */
const NAME_MAX_BYTES = 63;

function ddl(schema: string, table: PgTable) {
	const {
		name,
		columns,
		checks,
		foreignKeys,
		indexes,
		uniqueConstraints,
		primaryKeys,
	} = getTableConfig(table);
	for (const named of [
		...checks.map((c) => c.name),
		...foreignKeys.map((f) => f.getName()),
		...indexes.map((i) => i.config.name ?? ""),
		...uniqueConstraints.map((u) => u.getName() ?? ""),
	])
		if (Buffer.byteLength(named) > NAME_MAX_BYTES)
			throw new Error(
				`${name} 的约束或索引名超过 ${NAME_MAX_BYTES} 字节：${named}`,
			);
	const dialect = new PgDialect();
	const cols = columns.map((c) => {
		const parts = [`"${c.name}"`, c.getSQLType()];
		if (c.primary) parts.push("primary key");
		// 约束名照 drizzle 的默认（`<表>_<列>_unique`），测试才能按名字识别它
		if (c.isUnique)
			parts.push(
				`constraint "${c.uniqueName ?? `${name}_${c.name}_unique`}" unique`,
			);
		if (c.notNull && !c.primary) parts.push("not null");
		if (c.generatedIdentity)
			parts.push(
				`generated ${c.generatedIdentity.type === "always" ? "always" : "by default"} as identity`,
			);
		if (c.generated) {
			// 库自己算的列（experience.content_key）。表达式是 SQL 或字符串，照 drizzle 的形态取
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
 * 这张表，种子和查询的向量自然可比。
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
 * 语料侧写进 `embedding_space` 的 canary 原文。查询侧每次嵌入时都会重嵌它核对
 * 端点还在同一个空间里，所以测试模拟一次发布时也得原样写回这一串。
 */
export const CANARY = "talent-search embedding canary";

/** 两串字在假嵌入下的余弦，测试里用来解释断言的边界。 */
function fakeSimilarity(a: string, b: string) {
	const va = fakeEmbedding(a);
	const vb = fakeEmbedding(b);
	const similarity = va.reduce((s, x, i) => s + x * (vb[i] ?? 0), 0);
	return Math.min(1, Math.max(0, similarity));
}

/**
 * 假重排给的相关度：假余弦的平方。真重排对短查询词的分数也比余弦低一档，
 * 所以召回下限和判定门槛不在同一个尺度上，各自的作用在测试里也分得开。
 */
export function fakeRelevance(query: string, document: string) {
	return fakeSimilarity(query, document) ** 2;
}

type ModelGate = {
	enter: () => void;
	wait: Promise<void>;
};

let nextRerankGate: ModelGate | null = null;

let nextEmbeddingGate: ModelGate | null = null;

function modelGate() {
	let enter = () => {};
	let release = () => {};
	const entered = new Promise<void>((resolve) => {
		enter = resolve;
	});
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { gate: { enter, wait }, entered, release };
}

/** 暂停下一次重排请求，观察模型调用期间的语料变化。 */
export function holdNextRerank() {
	if (nextRerankGate) throw new Error("已经有一条重排请求在等待");
	const { gate, ...control } = modelGate();
	nextRerankGate = gate;
	return control;
}

/** 暂停下一次嵌入请求，观察向量生成到首份快照之间的空间变化。 */
export function holdNextEmbedding() {
	if (nextEmbeddingGate) throw new Error("已经有一条嵌入请求在等待");
	const { gate, ...control } = modelGate();
	nextEmbeddingGate = gate;
	return control;
}

let embeddingAnswer = fakeEmbedding;

/** 设置嵌入端点的输出，用来验证端点漂移的拒绝行为。 */
export function answerEmbedding(answer: (text: string) => number[]) {
	embeddingAnswer = answer;
	return () => {
		embeddingAnswer = fakeEmbedding;
	};
}

/**
 * 一行查询语法（`search/query-syntax.ts`）写成模型会提交的条件：经编译器写成查询，去掉 id
 * （新写的条件不带 id，由服务端发）和停用（真模型从不写停用）。
 */
export function drafted(syntax: string) {
	return compileConditions(parseQuery(syntax)).conditions.map(
		({ id: _id, off: _off, ...rest }) => rest,
	);
}

/**
 * 假理解：把那句话按一行查询语法读，接在当前条件后面提交整份——真模型遇到「再加上……」
 * 就是这么做的。
 */
function fakeIntent(text: string, base: unknown[]) {
	return { conditions: [...base, ...drafted(text)], note: null };
}

/**
 * 打开后，假理解先用一遍三个查询工具（看目录、查经历词、试跑）再提交，并记下发给
 * 查询理解端点的每一个请求体：工具的回答会跟着下一次请求发出去，隐私测试看的就是它们。
 */
let exploring: string[] | null = null;
export function exploreAndCapture(): { bodies: string[]; stop: () => void } {
	const bodies: string[] = [];
	exploring = bodies;
	return {
		bodies,
		stop: () => {
			exploring = null;
		},
	};
}

/** 那句话和当前条件在提示词里的位置，和 `src/server/llm.ts` 的 `understand` 写的一致。 */
const SENTENCE_PREFIX = "这句话：";
const BASE_PREFIX = "当前的条件表：";

function baseIn(prompt: string): unknown[] {
	const line = prompt
		.split("\n")
		.find((l) => l.startsWith(BASE_PREFIX))
		?.slice(BASE_PREFIX.length);
	return line ? (JSON.parse(line) as unknown[]) : [];
}

/**
 * 语料侧那三处聊天调用（抽取、对齐、整理）的假回答。
 *
 * 查询理解的提示词可以识别出来（那句话前面有 `SENTENCE_PREFIX`），剩下的都是语料侧
 * 的。它们的回答不像查询理解那样能从输入算出来——「这段描述里有哪些能力词」本来
 * 就是判断——所以由测试自己给，也把请求交给需要模拟端点限制的测试。
 */
let chatAnswer:
	| ((
			system: string,
			prompt: string,
			request: Record<string, unknown>,
	  ) => unknown)
	| null = null;

export function answerChat(
	fn: (
		system: string,
		prompt: string,
		request: Record<string, unknown>,
	) => unknown,
): () => void {
	chatAnswer = fn;
	return () => {
		chatAnswer = null;
	};
}

let intentBroken = false;
type IntentAnswer = (text: string, base: unknown[]) => unknown;
let intentAnswer: IntentAnswer | null = null;

/**
 * 换一份查询理解的回答跑完 `fn`，跑完就换回来。默认那份按一行查询语法作答，
 * 永远合规；要测「模型说的话不合规」那条路，就得让它说别的。`base` 是提示词里的
 * 当前条件。
 */
export async function answering<T>(
	answer: IntentAnswer,
	fn: () => Promise<T>,
): Promise<T> {
	intentAnswer = answer;
	try {
		return await fn();
	} finally {
		intentAnswer = null;
	}
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
						relevance_score: fakeRelevance(query, d),
					})),
				});
				return;
			}
			if (req.url === "/chat/completions") {
				if (intentBroken) {
					res.writeHead(500).end("假模型按要求失败");
					return;
				}
				const request = JSON.parse(body) as {
					messages: { role: string; content: string | null }[];
				};
				const { messages } = request;
				const users = messages
					.filter((m) => m.role === "user")
					.map((m) => m.content ?? "");
				const system = messages.find((m) => m.role === "system")?.content ?? "";
				const reply = (message: Record<string, unknown>, finish: string) =>
					json({
						id: "fake",
						object: "chat.completion",
						created: 0,
						model: "fake",
						choices: [{ index: 0, message, finish_reason: finish }],
						usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
					});
				// 识别出查询理解的提示词；默认不查词，直接用提交工具提交那张表
				const understanding = users.find((u) => u.includes(SENTENCE_PREFIX));
				if (understanding !== undefined) {
					const at = understanding.lastIndexOf(SENTENCE_PREFIX);
					const said = understanding.slice(at + SENTENCE_PREFIX.length);
					const table = (intentAnswer ?? fakeIntent)(
						said,
						baseIn(understanding),
					);
					exploring?.push(body);
					const explored = messages.some((m) => m.role === "tool");
					if (exploring && !explored) {
						const call = (name: string, input: unknown, n: number) => ({
							id: `explore-${n}`,
							type: "function",
							function: { name, arguments: JSON.stringify(input) },
						});
						const words = drafted(said).flatMap((c) =>
							Object.values(c.terms ?? {}).flat(),
						);
						reply(
							{
								role: "assistant",
								content: null,
								tool_calls: [
									call("discover", {}, 0),
									call(
										"discover",
										{ relation: "person", column: "education" },
										1,
									),
									call("lookup_experience", { texts: words }, 2),
									call(
										"probe",
										{
											conditions: (table as { conditions: unknown[] })
												.conditions,
										},
										3,
									),
								],
							},
							"tool_calls",
						);
						return;
					}
					reply(
						{
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: `call-${messages.length}`,
									type: "function",
									function: {
										name: "submit",
										arguments: JSON.stringify(table),
									},
								},
							],
						},
						"tool_calls",
					);
					return;
				}
				const prompt = users.at(-1);
				const content =
					prompt !== undefined && chatAnswer
						? JSON.stringify(await chatAnswer(system, prompt, request))
						: undefined;
				if (content === undefined) {
					res.writeHead(400).end("没有与这份提示词对应的假回答");
					return;
				}
				reply({ role: "assistant", content }, "stop");
				return;
			}
			const gate = nextEmbeddingGate;
			nextEmbeddingGate = null;
			if (gate) {
				gate.enter();
				await gate.wait;
			}
			const { input } = JSON.parse(body) as { input: string | string[] };
			const texts = Array.isArray(input) ? input : [input];
			json({
				object: "list",
				model: "fake",
				data: texts.map((t, index) => ({
					object: "embedding",
					index,
					embedding: embeddingAnswer(t),
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
						// close() 只停止接受新连接并关闭空闲连接；查询侧 fetch 池里的 keep-alive
						// 连接要靠 closeAllConnections() 一并关闭。Node 文档要求它在
						// close() 之后调用，否则有竞争。
						server.close(() => done());
						server.closeAllConnections();
					}),
			});
		});
	});
}

/**
 * 建立临时 schema 和合成端点，配置环境后才加载服务端单例。
 * 调用方必须 await setup() 后动态导入被测服务端模块；各文件使用 --parallel 隔离模块与环境。
 */
export async function setup() {
	const base = process.env.DATABASE_URL;
	if (!base)
		throw new Error(
			"DATABASE_URL 未配置，集成测试需要一个装了 pgvector 的本地 Postgres",
		);

	const admin = new Pool({ connectionString: base });
	await admin.query(`drop schema if exists ${SCHEMA} cascade`);
	await admin.query(`create schema ${SCHEMA}`);
	for (const t of [
		authUser,
		authSession,
		authAccount,
		authVerification,
		employee,
		experience,
		embeddingSpace,
		phrase,
		experiencePhrase,
		experienceNext,
		experiencePhraseNext,
		rerankCache,
		phraseGloss,
		searchTurn,
		term,
		reviewGroup,
		embeddingCache,
		completionCache,
		taskRun,
		recordStream,
		scale,
		employeeRecord,
		industry,
		company,
		companyAlias,
	])
		await admin.query(ddl(SCHEMA, t));
	// 视图里的表名不带 schema，建视图时按本文件的 schema 解析，绑定的就是本文件的表
	await admin.query(`create schema ${CATALOG}`);
	const viewClient = await admin.connect();
	try {
		await viewClient.query(`set search_path to ${SCHEMA}, public`);
		for (const view of CATALOG_VIEWS) {
			const { name, query } = getViewConfig(view);
			if (!query) throw new Error(`目录视图 ${name} 没有定义`);
			await viewClient.query(
				`create view ${CATALOG}."${name}" as ${new PgDialect().sqlToQuery(query).sql}`,
			);
		}
		await viewClient.query("reset search_path");
	} finally {
		viewClient.release();
	}
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
	// 语料侧那三处聊天调用也指向同一台假端点，回答由 `answerChat` 设置
	process.env.EXTRACT_BASE_URL = modelServer.url;
	process.env.EXTRACT_MODEL = "fake";
	process.env.EXTRACT_STRUCTURED_OUTPUTS = "true";
	delete process.env.ALIGN_MODEL;
	delete process.env.ALIGN_BASE_URL;
	delete process.env.ALIGN_API_KEY;
	process.env.REVIEW_MODEL = "review-fake";
	// 判定默认交给自带模型：测试外部判定的用例自己开启外部模式
	process.env.REVIEW_JUDGE = "model";
	delete process.env.REVIEW_TOKEN;
	process.env.EXTRACT_CONCURRENCY = "2";
	process.env.TALENT_SOURCE = "csv-dir";
	process.env.TALENT_CSV_DIR = "";
	process.env.TALENT_CATALOG_SCHEMA = CATALOG;

	return async function teardown() {
		const { pool } = await import("#/db");
		await pool.end();
		await modelServer.close();
		const a = new Pool({ connectionString: base });
		await a.query(`drop schema if exists ${CATALOG} cascade`);
		await a.query(`drop schema if exists ${SCHEMA} cascade`);
		await a.end();
	};
}

/**
 * 「这次写入被哪条约束拒绝了」。
 *
 * 识别的是 Postgres 返回的**约束名**，不是错误文案里恰好出现了那几个字：
 * 文案里能出现约束名的错有好几种（比如提到同一张表的另一条约束），按文案匹配就会
 * 出现「写入确实被拒绝了，但不是被这一条约束拒绝的」而测试照样通过。
 */
export const violates = (constraint: string) => (error: unknown) =>
	(error as { cause?: { constraint?: string } }).cause?.constraint ===
	constraint;

/** 一个人 + 他的若干段经历。字段用默认值兜底，测试里只写与断言相关的那几个。 */
type Seed = {
	empId: string;
	name: string;
	/** 夹具里职级自成一档，档高取名字里的数字（P6 → 6） */
	curLevel?: string;
	recruitment?: string;
	education?: string;
	school?: string;
	schoolTier?: string;
	overseasEducated?: boolean;
	segments: Array<{
		kind?: "internal" | "external";
		unemployed?: boolean;
		months: number;
		/** 省略表示至今。近因因子看的就是它。 */
		endDate?: string;
		/** 入职前的公司名 */
		company?: string;
		/** 公司内的部门名与部门路径 */
		department?: string;
		departmentPath?: string;
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
			/** 只写词就是没判断出档；档存在边上（真语料里由 conform 校验取值）。 */
			skills?: (string | { text: string; engagement: Engagement })[];
		};
	}>;
};

/** 一条合成的记录流：评级流带档（从低到高），记录按期给。 */
export type StreamSeed = {
	stream: string;
	kind: "rating" | "status";
	label: string;
	period?: string;
	scale?: readonly string[];
	records: {
		empId: string;
		value: string;
		periodStart: string;
		periodEnd?: string;
	}[];
};

/**
 * 一家合成的公司。行业两列照库里存的样子给：已经连同上级展开（真语料里由管线展开）。
 * 经历上的公司写法默认就是公司名，另有写法时写在 `aliases`。
 */
export type CompanySeed = {
	name: string;
	group?: string;
	industries?: string[];
	mainIndustries?: string[];
	circles?: string[];
	aliases?: string[];
};

/** 写公司知识：行业树（行业 → 上级）、公司和经历上的写法，和同步写的三张表一样。 */
export async function seedCompanies(
	tree: Record<string, string | null>,
	companies: CompanySeed[],
) {
	const { db } = await import("#/db");
	const { industry, company, companyAlias } = await import("#/db/schema");
	// 上级先写：自引用的外键逐行检查
	const names = Object.keys(tree);
	const depth = (name: string): number =>
		tree[name] ? depth(tree[name]) + 1 : 0;
	for (const name of names.sort((a, b) => depth(a) - depth(b)))
		await db.insert(industry).values({ name, parent: tree[name] });
	await db.insert(company).values(
		companies.map((c) => ({
			name: c.name,
			groupName: c.group ?? c.name,
			industries: c.industries ?? [],
			mainIndustries: c.mainIndustries ?? [],
			circles: c.circles ?? [],
		})),
	);
	await db.insert(companyAlias).values(
		companies.flatMap((c) =>
			(c.aliases ?? [c.name]).map((rawName) => ({
				rawName,
				company: c.name,
			})),
		),
	);
}

/** 写一条记录流：流本身、评级流的档位表和每个人的记录，和同步写的三张表一样。 */
export async function seedStream(s: StreamSeed) {
	const { db } = await import("#/db");
	const { recordStream, scale, employeeRecord } = await import("#/db/schema");
	await db.insert(recordStream).values({
		stream: s.stream,
		kind: s.kind,
		label: s.label,
		period: s.period ?? "",
	});
	if (s.scale?.length)
		await db
			.insert(scale)
			.values(
				s.scale.map((value, rank) => ({ stream: s.stream, value, rank })),
			);
	if (s.records.length > 0)
		await db
			.insert(employeeRecord)
			.values(s.records.map((r) => ({ ...r, stream: s.stream })));
}

export async function seed(rows: Seed[]) {
	const { db } = await import("#/db");
	const {
		employee: emp,
		experience: exp,
		phrase: ph,
		experiencePhrase: ep,
		scale: sc,
		ORDINAL_STREAM,
	} = await import("#/db/schema");
	const { EDUCATION_LADDER } = await import("#/corpus/contract");
	const rankOf = (level: string) => Number(level.replace(/\D/g, ""));
	const educationRank = (education: string) =>
		(EDUCATION_LADDER as readonly string[]).indexOf(education) + 1;
	await db.insert(emp).values(
		rows.map((r) => ({
			empId: r.empId,
			name: r.name,
			curLevel: r.curLevel ?? "",
			curLevelBand: r.curLevel ?? "",
			curLevelRank: r.curLevel ? rankOf(r.curLevel) : null,
			recruitment: r.recruitment ?? "",
			educationLevel: r.education ?? "",
			educationRank: r.education ? educationRank(r.education) : null,
			school: r.school ?? "",
			schoolTier: r.schoolTier ?? "",
			overseasEducated: r.overseasEducated ?? null,
		})),
	);
	// 档位表和同步写的一样（`corpus/pipeline.ts` 的 `scaleRows`）：职级档取人身上出现过的档和
	// 档高，学历按契约的五档；「某档及以上」查的就是它。多次 seed 时已有的档不重写
	const levels = new Map(
		rows.flatMap((r) => (r.curLevel ? [[r.curLevel, rankOf(r.curLevel)]] : [])),
	);
	await db
		.insert(sc)
		.values([
			...[...levels].map(([value, rank]) => ({
				stream: ORDINAL_STREAM.level,
				value,
				rank,
			})),
			...EDUCATION_LADDER.map((value, index) => ({
				stream: ORDINAL_STREAM.education,
				value,
				rank: index + 1,
			})),
		])
		.onConflictDoNothing();
	let day = 1;
	if (rows.every((row) => row.segments.length === 0)) return;
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
						unemployed: s.unemployed ?? false,
						startDate: start,
						endDate: s.endDate ?? null,
						company: s.company ?? "",
						department: s.department ?? "",
						departmentPath: s.departmentPath ?? "",
						title: s.title ?? "",
						seqL1: s.seqL1 ?? "",
						seqL2: s.seqL2 ?? "",
						seqInferredL1: s.seqInferredL1 ?? "",
						seqInferredL2: s.seqInferredL2 ?? "",
						description: s.description ?? "",
						months: s.months,
						companyMeta: s.companyTag
							? {
									company_tag: s.companyTag,
									nature: "",
								}
							: null,
					};
				}),
			),
		)
		.returning();
	// 说法去重后各嵌一次，经历段按路指向它们——组合方式和 src/corpus/derive.ts 是
	// 同一个函数。抽取结果夹具直接给：seed 的入参和 inserted 顺序一致，按下标对回去。
	const specs = rows.flatMap((r) => r.segments);
	const links = inserted.flatMap((s, i) => {
		const extracted = specs[i]?.extracted;
		return phrasesOf(
			s,
			extracted
				? {
						items: (extracted.skills ?? []).map((one) =>
							typeof one === "string" ? { text: one, engagement: null } : one,
						),
					}
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
			engagement: l.engagement,
		})),
	);
}
