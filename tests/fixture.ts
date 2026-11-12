/**
 * 集成测试使用临时 schema、真实 PostgreSQL 和进程内合成模型端点。
 * 表结构由 schema.ts 推导；不创建索引。字符袋嵌入、按查询语法读句子和按字面读经历的假理解用于
 * 验证机制，真实模型的语义质量由 eval 验收。测试运行不读取真实人才数据或模型密钥。
 */
import { createServer } from "node:http";
import { type SQL, sql } from "drizzle-orm";
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
	employee,
	employeeRecord,
	experience,
	experienceNext,
	experiencePhrase,
	experiencePhraseNext,
	experienceVerdict,
	industry,
	phrase,
	recordStream,
	reviewWord,
	scale,
	searchTurn,
	taskRun,
	term,
} from "#/db/schema";
import type { Engagement } from "#/lib/engagement";
import { compileConditions } from "#/search/compile";
import type { QueryCondition } from "#/search/query";
import { parseQuery } from "#/search/query-syntax";
import type { TraceStep } from "#/search/trace";
import { catalogOf, tempSchema } from "./temp-schema";

/**
 * 每个测试文件使用进程号和随机值组成的临时 schema。
 * bun test --parallel 隔离模块与环境，但多个文件可共用同一 worker 进程。
 */
const SCHEMA = tempSchema();

/** 这个测试文件的数据目录（`schema.ts` 的 `catalog`）：视图建在这里，指向本文件的表。 */
const CATALOG = catalogOf(SCHEMA);

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
 * 所以两串字的余弦 = 共有字数 / √(字数 × 字数)：整理给一个词配哪些参考词在测试里算得出来。
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
 * 假模型读一段经历算不算：测试里的判据写成「符合：甲、乙；不算：丁」，经历的文字里含「不算」
 * 后面的任一个词就是不算，否则含「符合」的词才算。真模型怎么判由验收衡量，这里只让机制有
 * 确定的输入。
 */
function fakeFits(criterion: string, text: string): boolean {
	const has = (list: "符合" | "不算") =>
		(new RegExp(`${list}：([^；]*)`).exec(criterion)?.[1] ?? "")
			.split("、")
			.map((word) => word.trim())
			.filter(Boolean)
			.some((word) => text.includes(word));
	return !has("不算") && has("符合");
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
 * （新写的条件不带 id，由服务端发）和停用（真模型从不写停用）。经历词除了编成按字面包含的
 * 正则，还写成判据「符合：词、词」：模型写的「做过什么」都带判据，假模型读经历时把文字里含
 * 这些词的段判成符合（`fakeFits`）。
 */
export function drafted(syntax: string) {
	const conditions = parseQuery(syntax);
	return compileConditions(conditions).conditions.map(
		({ id: _id, off: _off, seek, ...rest }, i) => {
			const asked = conditions[i];
			const words = asked?.about === "experience" ? asked.what : undefined;
			return {
				...rest,
				...(seek && {
					seek: { ...seek, criterion: `符合：${words?.join("、")}` },
				}),
			};
		},
	);
}

/**
 * 一条写了判据的经历条件，对话里模型写的那种：几条正则按字面捞，哪一段算数看存下的结论。
 * id 也当标签用，`where` 默认不限，别的项从 `over` 上盖。
 */
export function judged(
	id: string,
	patterns: readonly string[],
	criterion: string,
	over: Omit<Partial<QueryCondition>, "seek"> = {},
): QueryCondition & { seek: { patterns: string[]; criterion: string } } {
	return {
		id,
		label: id,
		mode: "must",
		from: "experience",
		seek: { patterns: [...patterns], criterion },
		where: "true",
		...over,
	};
}

/**
 * 假理解写的条件：把那句话按一行查询语法读，接在当前条件后面提交整份——真模型遇到「再加上……」
 * 就是这么做的。提交之前它先用 `read` 把候选人没看过的经历取来，一批一批用 `judge` 交上符合
 * 的段的编号（`fakeFits`），都看完了再交（见 `startModelServer`）。
 */
function fakeIntent(text: string, base: unknown[]) {
	return { conditions: [...base, ...drafted(text)], note: null };
}

/**
 * `read` 和 `judge` 带回的样子（`server/agent-tools.ts`）：还剩几段，一批经历按条件分组、每段有
 * 编号；没有可读的时没有 `groups`。
 */
export type Batch = {
	left: number;
	groups?: {
		label: string;
		criterion: string;
		segments: { n: number; text: string }[];
	}[];
	todo?: string;
	saved?: number;
	problem?: string;
};

/** `probe` 带回的样子。 */
export type Tried = {
	conditions: { people: number | null; problem: string | null }[];
	total: number | null;
	candidates: number | null;
	unread: number;
	todo: string;
};

/** `submit` 带回的样子。 */
export type Checked = { passed: boolean; problems?: string[] };

/** 模型提交的一整份：条件和说明。 */
export function table(conditions: unknown[], note: unknown = null) {
	return { conditions, note };
}

/**
 * 一套查询理解的工具，连同它记下的步骤；结论和生产一样存在这次找人任务名下。`call` 按工具的
 * 入参直接调：SDK 的工具外壳只在模型调用时才有上下文。每调一次就是模型的一步，调之前先走到
 * 下一步（`advance`），上一步给出的那一批才到模型眼前。
 */
export async function agentOn(
	rootTurnId: string,
	base: readonly QueryCondition[] = [],
) {
	const { agentTools } = await import("#/server/agent-tools");
	const { saveVerdicts } = await import("#/server/judged");
	const { db } = await import("#/db");
	const steps: TraceStep[] = [];
	const agent = agentTools({
		rootTurnId,
		base,
		record: async (step, verdicts) => {
			await saveVerdicts(rootTurnId, verdicts, db);
			steps.push(step);
		},
	});
	const call = <T = unknown>(
		name: keyof typeof agent.tools,
		input: unknown,
	): Promise<T> => {
		agent.advance();
		const execute = agent.tools[name].execute as (
			input: unknown,
			options: unknown,
		) => Promise<T>;
		return execute(input, { toolCallId: "t", messages: [] });
	};
	return { ...agent, call, steps };
}

/** 一段文字是不是一批要读的经历。 */
function batchOf(text: string | null | undefined) {
	if (!text) return null;
	try {
		const result = JSON.parse(text) as Partial<Batch>;
		return Array.isArray(result.groups) ? (result as Batch) : null;
	} catch {
		return null;
	}
}

/** 最后一条消息是不是工具带回的一批要读的经历。 */
function batchIn(
	message: { role: string; content: string | null } | undefined,
) {
	return message?.role === "tool" ? batchOf(message.content) : null;
}

/** 假模型交的结论：这一批里符合的段的编号。 */
function fitsIn(batch: Batch | null) {
	return {
		fits: (batch?.groups ?? []).flatMap((group) =>
			group.segments
				.filter((segment) => fakeFits(group.criterion, segment.text))
				.map((segment) => segment.n),
		),
	};
}

/**
 * 打开后，假理解先用一遍三个查询工具（看目录、捞说法、试跑）再读经历、提交，并记下发给
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

/** 整理发给判定方的一段提问里要判的是哪个词。 */
export function askedWord(prompt: string): string {
	return /^要判的词：(.+)（\d+ 人）$/m.exec(prompt)?.[1] ?? "";
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
 * OpenAI 兼容的 `/embeddings` 与 `/chat/completions`，只认这两个路径。
 */
function startModelServer() {
	const server = createServer((req, res) => {
		if (
			req.method !== "POST" ||
			!["/embeddings", "/chat/completions"].includes(req.url ?? "")
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
			if (req.url === "/chat/completions") {
				if (intentBroken) {
					res.writeHead(500).end("假模型按要求失败");
					return;
				}
				const request = JSON.parse(body) as {
					messages: {
						role: string;
						content: string | null;
						tool_calls?: { function: { name: string } }[];
					}[];
					tool_choice?: { function?: { name?: string } } | string;
					tools?: { function: { name: string } }[];
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
				const calls = (list: [name: string, input: unknown][]) =>
					reply(
						{
							role: "assistant",
							content: null,
							tool_calls: list.map(([name, input], n) => ({
								id: `call-${messages.length}-${n}`,
								type: "function",
								function: { name, arguments: JSON.stringify(input) },
							})),
						},
						"tool_calls",
					);
				// 只给了交结论这一个工具：HR 直接改条件之后把候选人确认完（`llm.ts` 的 `confirm`）。
				// 每一批都在最后一条工具消息里：第一批也是作为一次交结论带回的结果给的
				if (
					request.tools?.length === 1 &&
					request.tools[0]?.function.name === "judge"
				) {
					exploring?.push(body);
					calls([["judge", fitsIn(batchIn(messages.at(-1)))]]);
					return;
				}
				// 识别出查询理解的提示词：先把候选人的经历读完、交上结论，再用提交工具提交那张表
				const understanding = users.find((u) => u.includes(SENTENCE_PREFIX));
				if (understanding !== undefined) {
					const at = understanding.lastIndexOf(SENTENCE_PREFIX);
					const said = understanding.slice(at + SENTENCE_PREFIX.length);
					const table = (intentAnswer ?? fakeIntent)(
						said,
						baseIn(understanding),
					) as { conditions?: unknown };
					exploring?.push(body);
					const called = new Set(
						messages.flatMap((m) =>
							(m.tool_calls ?? []).map((c) => c.function.name),
						),
					);
					const conditions = table?.conditions ?? [];
					const batch = batchIn(messages.at(-1));
					// 最后一次只剩提交这一个工具
					const submitOnly =
						typeof request.tool_choice === "object" &&
						request.tool_choice.function?.name === "submit";
					if (submitOnly) calls([["submit", table]]);
					else if (exploring && called.size === 0)
						calls([
							["discover", {}],
							["discover", { relation: "person", column: "education" }],
							[
								"find",
								{
									patterns: drafted(said).flatMap(
										(c) => c.seek?.patterns ?? [],
									),
								},
							],
							["probe", { conditions }],
						]);
					else if (batch) calls([["judge", fitsIn(batch)]]);
					else if (!called.has("read")) calls([["read", { conditions }]]);
					else calls([["submit", table]]);
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
		throw new Error("DATABASE_URL 未配置，集成测试需要一个本地 Postgres 17");

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
		phrase,
		experiencePhrase,
		experienceNext,
		experiencePhraseNext,
		searchTurn,
		experienceVerdict,
		term,
		reviewWord,
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
	await admin.end();

	const url = new URL(base);
	url.searchParams.set("options", `-c search_path=${SCHEMA},public`);
	process.env.DATABASE_URL = url.toString();

	const modelServer = await startModelServer();
	process.env.EMBED_BASE_URL = modelServer.url;
	process.env.EMBED_MODEL = "fake";
	process.env.EMBED_SPACE_ID = "fake-v1";
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
type StreamSeed = {
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
type CompanySeed = {
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
	// 说法去重后各存一行，经历段按路指向它们——组合方式和 src/corpus/derive.ts 是
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
		.values(texts.map((text) => ({ text })))
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

/** 开一次找人任务（一条空条件的链），返回它的 id：结论记在一次任务名下，也只在它里面算数。 */
export async function openSearch(): Promise<string> {
	const { createTurn } = await import("#/server/turn");
	const { emptySpec } = await import("#/search/spec");
	const { turnId } = await createTurn({ kind: "spec", spec: emptySpec() });
	return turnId;
}

/**
 * 给几个人的经历在一次找人任务里、一条判据下存上结论（算或不算），和查询理解看完交上来的
 * 走同一条路（`server/judged.ts`）。
 * 这几个人的每一段都存；写了 `title` 只存岗位是它的那些段。
 */
export async function conclude(
	rootTurnId: string,
	criterion: string,
	fits: boolean,
	empIds: readonly string[],
	title?: string,
) {
	const { db } = await import("#/db");
	const { saveVerdicts, segmentTexts } = await import("#/server/judged");
	const { rows } = await db.execute<{ id: number }>(sql`
		select id from experience
		where emp_id = any(${sql.param([...empIds])}::text[])
			and (${title ?? null}::text is null or title = ${title ?? null})`);
	const segments = await segmentTexts(rows.map((row) => row.id));
	if (segments.size !== rows.length || rows.length === 0)
		throw new Error(`没有找到要存结论的经历：${empIds.join("、")}`);
	await saveVerdicts(
		rootTurnId,
		[...segments.values()].map(({ content }) => ({
			criterion,
			content,
			fits,
		})),
		db,
	);
}
