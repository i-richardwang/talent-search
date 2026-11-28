/**
 * 集成测试使用临时 schema、真实 PostgreSQL 和进程内合成模型端点。
 * 表结构、约束与唯一索引由 schema.ts 推导。字符袋嵌入、按查询语法读句子和按字面读经历的假理解用于
 * 验证机制，真实模型的语义质量由 eval 验收。测试运行不读取真实人才数据或模型密钥。
 */
import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import type { Member, Question } from "#/corpus/judgment";
import { phrasesOf } from "#/corpus/route-texts";
import { accountScope, authUser, EMBED_DIM } from "#/db/schema";
import type { Engagement } from "#/lib/engagement";
import { compileConditions } from "#/search/compile";
import type { QueryCondition } from "#/search/query";
import { parseQuery } from "#/search/query-syntax";
import type { TraceStep } from "#/search/trace";
import type { Batch, Judge, RecordStep } from "#/server/reading";
import { isolatedDatabase } from "../scripts/evaluation/database";

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

let embeddingAnswer: (text: string) => number[] | Promise<number[]> =
	fakeEmbedding;

/** 设置嵌入端点的输出，用来验证端点漂移的拒绝行为。 */
export function answerEmbedding(answer: typeof embeddingAnswer) {
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
 * 就是这么做的。提交之前它先用 `read` 让候选人没读过的经历读完，读完再交（见 `startModelServer`）；
 * 读经历的请求按 `fakeFits` 交上符合的段的编号。
 */
function fakeIntent(text: string, base: unknown[]) {
	return { conditions: [...base, ...drafted(text)], note: null };
}

/** `read` 带回的样子（`server/agent-tools.ts`）：每条读了多少段、多少段算数，还剩几段。 */
export type Read = {
	conditions?: { label: string; read: number; fits: number }[];
	left: number;
	todo?: string;
};

/** 读一批经历时每一段都算。 */
export const fitsAll: Judge = async (batch) =>
	batch.segments.map((segment) => segment.n);

/** 读一批经历时，文字过得了 `keep` 的段才算。 */
export const fitsWhere =
	(keep: (text: string, batch: Batch) => boolean): Judge =>
	async (batch) =>
		batch.segments
			.filter((segment) => keep(segment.text, batch))
			.map((segment) => segment.n);

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
 * 一套查询理解的工具，连同它记下的步骤和读经历时每一批给出去的内容（`seen`）；结论和生产一样
 * 存在这次找人任务名下。`call` 按工具的入参直接调：SDK 的工具外壳只在模型调用时才有上下文。
 * 读经历不经过模型：每一批算不算由 `judge` 给，默认每一段都算。
 */
export async function agentOn(
	rootTurnId: string,
	base: readonly QueryCondition[] = [],
	judge: Judge = fitsAll,
) {
	const { agentTools } = await import("#/server/agent-tools");
	const { reader } = await import("#/server/reading");
	const { db } = await import("#/db");
	const steps: TraceStep[] = [];
	const seen: Batch[] = [];
	const record: RecordStep = async (step, persist) => {
		await persist?.(db);
		steps.push(step);
	};
	const agent = agentTools({
		rootTurnId,
		base,
		record,
		reading: reader({
			rootTurnId,
			record,
			judge: (batch, abortSignal) => {
				seen.push(batch);
				return judge(batch, abortSignal);
			},
		}),
	});
	const call = <T = unknown>(
		name: keyof typeof agent.tools,
		input: unknown,
	): Promise<T> => {
		const execute = agent.tools[name].execute as (
			input: unknown,
			options: unknown,
		) => Promise<T>;
		return execute(input, { toolCallId: "t", messages: [] });
	};
	return { ...agent, call, steps, seen };
}

/** 假模型交的结论：这一批里符合的段的编号。 */
function fitsIn(batch: Batch) {
	return {
		fits: batch.segments
			.filter((segment) => fakeFits(batch.criterion, segment.text))
			.map((segment) => segment.n),
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
function promptOf(question: Question): string {
	const line = (one: Member) => `${one.word}（${one.people} 人）`;
	return `要判的词：${line(question)}\n参考词：\n${question.near.map(line).join("\n")}`;
}

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

type CorpusStep = (
	replies: Record<string, unknown>[],
	kind: "extract" | "align" | "review",
) => string | [string, unknown][] | undefined;
let corpusStep: CorpusStep | undefined;

/** 让合成处理员在指定步骤自行选择工具，或只回答一段文字。 */
export function answerCorpusStep(step: CorpusStep) {
	corpusStep = step;
	return () => {
		corpusStep = undefined;
	};
}

type ScoreAnswer = (segments: Batch["segments"]) => unknown;
let scoreAnswer: ScoreAnswer | null = null;
export async function answeringScores<T>(
	answer: ScoreAnswer,
	run: () => Promise<T>,
) {
	scoreAnswer = answer;
	try {
		return await run();
	} finally {
		scoreAnswer = null;
	}
}

let intentBroken = false;
let strayBraces = false;
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
 * 让假模型交提交时在参数后面多写两个右括号，直到调用返回的恢复函数为止：真实端点偶尔这样写。
 */
export function bracesAfterSubmit(): () => void {
	strayBraces = true;
	return () => {
		strayBraces = false;
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

let resumeAnswer: unknown;
let resumeImageFirst = false;
let resumeTrace = { tools: [] as string[], images: [] as string[] };
export function answerResume(value: unknown, imageFirst = false) {
	resumeAnswer = value;
	resumeImageFirst = imageFirst;
	resumeTrace = { tools: [], images: [] };
	return resumeTrace;
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
								function: {
									name,
									arguments:
										JSON.stringify(input) +
										(strayBraces && name === "submit" ? "}}" : ""),
								},
							})),
						},
						"tool_calls",
					);
				if (request.tools?.some((t) => t.function.name === "read_page_text")) {
					const replies = messages.filter((m) => m.role === "tool");
					const previous = messages.flatMap(
						(m) => m.tool_calls?.map((t) => t.function.name) ?? [],
					);
					const lastTool = previous.at(-1);
					const imageParts = messages.flatMap((m) =>
						m.role === "user" && Array.isArray(m.content)
							? m.content
									.filter((p) => p.type === "image_url")
									.map((p) => p.image_url.url as string)
							: [],
					);
					if (
						messages.some(
							(m) =>
								m.role === "tool" &&
								JSON.stringify(m.content).includes("base64,"),
						) ||
						(previous.includes("view_page_image") && !imageParts.length)
					) {
						res.writeHead(400).end("缺少标准 user 图片消息");
						return;
					}
					let next: string, input: unknown;
					if (!previous.length) {
						next = resumeImageFirst ? "view_page_image" : "read_page_text";
						input = { page: 1 };
					} else if (
						lastTool === "submit_resume" &&
						JSON.parse(replies.at(-1)?.content ?? "{}").error === "请先读完各页"
					) {
						next = "read_page_text";
						input = { page: 2 };
					} else if (
						lastTool === "read_page_text" &&
						JSON.parse(replies.at(-1)?.content ?? "{}").text === ""
					) {
						next = "view_page_image";
						input = { page: 1 };
					} else {
						next = "submit_resume";
						input = {
							resume: lastTool === "submit_resume" ? resumeAnswer : { name: 7 },
						};
					}
					resumeTrace.tools.push(next);
					if (imageParts.length) resumeTrace.images = imageParts;
					return calls([[next, input]]);
				}
				// 语料 agent 从工具结果读题，并以真正的 tool_calls 作答。
				const deriveAgent = request.tools?.some(
					(t) => t.function.name === "derive_list",
				);
				const reviewAgent = request.tools?.some(
					(t) => t.function.name === "review_list",
				);
				if (deriveAgent || reviewAgent) {
					const kind = reviewAgent
						? "review"
						: users.at(-1)?.includes("align")
							? "align"
							: "extract";
					const replies = messages
						.filter((m) => m.role === "tool")
						.map((m) => JSON.parse(m.content ?? "null"));
					const step = corpusStep?.(replies, kind);
					if (step !== undefined) {
						if (typeof step === "string")
							reply({ role: "assistant", content: step }, "stop");
						else calls(step);
						return;
					}
					if (!replies.length) {
						calls([
							[
								reviewAgent ? "review_list" : "derive_list",
								reviewAgent ? {} : { kind },
							],
						]);
						return;
					}
					const batch = replies[0];
					if (!chatAnswer) {
						res.writeHead(400).end("假处理员没有设置回答");
						return;
					}
					if (reviewAgent) {
						const decisions: [string, unknown][] = [];
						const retry = new Set(replies.slice(1).map((r) => r.retry));
						for (const word of batch.words.filter(
							(w: { id: number }) => replies.length === 1 || retry.has(w.id),
						))
							decisions.push([
								"review_submit",
								{
									id: word.id,
									guideIdentity: word.guideIdentity,
									judge: "builtin",
									judgment: await chatAnswer(
										batch.guide.text,
										promptOf(word),
										request,
									),
								},
							]);
						calls(decisions);
					} else {
						const { promptInput } = await import("#/corpus/extract");
						const results = [];
						if (replies.length > 1) {
							for (const item of replies.at(-1).results)
								if (item.status === "invalid")
									results.push({ id: item.id, unable: true });
						} else {
							for (const input of batch.inputs)
								results.push({
									id: input.id,
									result: await chatAnswer(
										batch.instructions,
										promptInput(input),
										request,
									),
								});
						}
						calls([
							["derive_submit", { kind, standard: batch.standard, results }],
						]);
					}
					return;
				}
				// 只给了交结论这一个工具：读一批经历的请求（`llm.ts` 的 `judgeSegments`），
				// 这一批写在用户消息里
				if (
					request.tools?.length === 1 &&
					request.tools[0]?.function.name === "judge"
				) {
					exploring?.push(body);
					calls([["judge", fitsIn(JSON.parse(users.at(-1) ?? "") as Batch)]]);
					return;
				}
				if (
					request.tools?.length === 1 &&
					request.tools[0]?.function.name === "score"
				) {
					exploring?.push(body);
					const { segments } = JSON.parse(users.at(-1) ?? "") as Batch;
					calls([
						[
							"score",
							scoreAnswer
								? scoreAnswer(segments)
								: { scores: segments.map(({ n }) => ({ n, score: 1 })) },
						],
					]);
					return;
				}
				// 识别出查询理解的提示词：先让候选人的经历读完，再用提交工具提交那张表
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
					else if (!called.has("read")) calls([["read", { conditions }]]);
					else calls([["submit", table]]);
					return;
				}
				res.writeHead(400).end("没有匹配的工具调用");
				return;
			}
			const { input } = JSON.parse(body) as { input: string | string[] };
			const texts = Array.isArray(input) ? input : [input];
			json({
				object: "list",
				model: "fake",
				data: await Promise.all(
					texts.map(async (t, index) => ({
						object: "embedding",
						index,
						embedding: await embeddingAnswer(t),
					})),
				),
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

/** 每个临时 schema 里都有的一个账号：测试里的找人任务记在它名下。 */
export const OWNER = "synthetic-owner";

/** 夹具里的人默认在的组织，也是 `OWNER` 的数据范围：没写组织的人 `OWNER` 都看得到。 */
export const ORG = "合成集团";

/** 建一个账号，数据范围是这几个组织；返回它的 id。 */
export async function account(id: string, orgs: readonly string[]) {
	const { db } = await import("#/db");
	await db.insert(authUser).values({
		id,
		name: id,
		email: `${id}@users.invalid`,
		username: id,
	});
	if (orgs.length > 0)
		await db
			.insert(accountScope)
			.values(orgs.map((orgPath) => ({ userId: id, orgPath })));
	return id;
}

/**
 * 建立临时 schema 和合成端点，配置环境后才加载服务端单例。
 * 调用方必须 await setup() 后动态导入被测服务端模块；各文件使用 --parallel 隔离模块与环境。
 */
export async function setup({ corpusWriter = false } = {}) {
	const base = process.env.DATABASE_URL;
	if (!base)
		throw new Error("DATABASE_URL 未配置，集成测试需要一个本地 Postgres 17");

	const isolated = await isolatedDatabase(base);
	process.env.DATABASE_URL = isolated.url;
	process.env.TALENT_CATALOG_SCHEMA = isolated.catalog;
	const accountClient = new Client({ connectionString: isolated.url });
	await accountClient.connect();
	try {
		await accountClient.query(
			"insert into auth_user (id,name,email,username) values ($1,'合成账号','owner@users.invalid','synthetic.owner')",
			[OWNER],
		);
		await accountClient.query(
			"insert into account_scope (user_id,org_path) values ($1,$2)",
			[OWNER, ORG],
		);
	} finally {
		await accountClient.end();
	}

	const modelServer = await startModelServer();
	process.env.EMBED_BASE_URL = modelServer.url;
	process.env.EMBED_MODEL = "fake";
	process.env.EMBED_SPACE_ID = "fake-v1";
	process.env.LLM_BASE_URL = modelServer.url;
	process.env.LLM_MODEL = "fake";
	// 语料侧那三处聊天调用也指向同一台假端点，回答由 `answerChat` 设置
	process.env.RESUME_BASE_URL = modelServer.url;
	process.env.RESUME_MODEL = "fake-resume";
	delete process.env.RESUME_API_KEY;
	process.env.EXTRACT_BASE_URL = modelServer.url;
	process.env.EXTRACT_MODEL = "fake";
	delete process.env.ALIGN_MODEL;
	delete process.env.ALIGN_BASE_URL;
	delete process.env.ALIGN_API_KEY;
	process.env.REVIEW_MODEL = "review-fake";
	// 判定默认交给自带模型：测试外部判定的用例自己开启外部模式
	process.env.REVIEW_JUDGE = "model";
	delete process.env.REVIEW_TOKEN;
	process.env.TALENT_SOURCE = "csv-dir";
	process.env.TALENT_CSV_DIR = "";

	// 写者锁属于整个数据库。要验证拿锁、放锁的测试文件即使各用一个 schema 也要排队。
	const writer = corpusWriter ? new Client({ connectionString: base }) : null;
	if (writer) {
		await writer.connect();
		await writer.query(
			"select pg_advisory_lock(hashtext('talent-search'), hashtext('test-writers'))",
		);
	}
	return async function teardown() {
		const { pool } = await import("#/db");
		try {
			await pool.end();
		} finally {
			await writer?.end();
		}
		await modelServer.close();
		await isolated.close();
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
	personId: string;
	name: string;
	/** 夹具里职级自成一档，档高取名字里的数字（P6 → 6） */
	curLevel?: string;
	/** 此刻所在的部门路径，数据范围按它判断；默认在 `ORG` */
	org?: string;
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
		/** 外部的公司名 */
		company?: string;
		/** 公司内的部门名与部门路径 */
		department?: string;
		departmentPath?: string;
		title?: string;
		seqL1?: string;
		seqL2?: string;
		/** 外部的段由模型对齐的序列（真语料里由 src/corpus/align.ts 写；夹具直接给）。 */
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
		personId: string;
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

/**
 * 写进合成的人和经历，再更新这几张表的统计信息。生产的表由 autovacuum 维护统计信息；读取策略的
 * 子查询让执行计划依赖它，从没分析过的表会选出慢得多的计划。
 */
export async function seed(rows: Seed[]) {
	await insertSeed(rows);
	const { db } = await import("#/db");
	await db.execute(
		sql`analyze person,employment,profile_source,profile_experience, experience, experience_phrase, phrase, scale`,
	);
}

async function insertSeed(rows: Seed[]) {
	const { db } = await import("#/db");
	const {
		person,
		employment,
		profileSource,
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
	await db.insert(person).values(
		rows.map((r) => ({
			personId: r.personId,
			name: r.name,
			educationLevel: r.education ?? "",
			educationRank: r.education ? educationRank(r.education) : null,
			school: r.school ?? "",
			schoolTier: r.schoolTier ?? "",
			overseasEducated: r.overseasEducated ?? null,
		})),
	);
	await db.insert(employment).values(
		rows.map((r) => ({
			personId: r.personId,
			empId: r.personId,
			curLevel: r.curLevel ?? "",
			curDeptPath: r.org ?? ORG,
			curLevelBand: r.curLevel ?? "",
			curLevelRank: r.curLevel ? rankOf(r.curLevel) : null,
			recruitment: r.recruitment ?? "",
		})),
	);
	await db.insert(profileSource).values(
		rows.map((r) => ({
			personId: r.personId,
			sourceKind: "hris",
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
						personId: r.personId,
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
	await db.execute(sql`insert into profile_experience(profile_id,person_id,experience_id)
			select f.id,e.person_id,e.id from experience e join profile_source f using(person_id)
			where f.source_kind='hris' and e.id=any(${sql.param(inserted.map((e) => e.id))}::int[])`);

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
	const { turnId } = await createTurn(OWNER, {
		kind: "spec",
		spec: emptySpec(),
	});
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
	personIds: readonly string[],
	title?: string,
) {
	const { db } = await import("#/db");
	const { saveVerdicts, segmentTexts } = await import("#/server/judged");
	const { rows } = await db.execute<{ id: number }>(sql`
		select id from experience
		where person_id = any(${sql.param([...personIds])}::text[])
			and (${title ?? null}::text is null or title = ${title ?? null})`);
	const segments = await segmentTexts(
		rootTurnId,
		rows.map((row) => row.id),
	);
	if (segments.size !== rows.length || rows.length === 0)
		throw new Error(`没有找到要存结论的经历：${personIds.join("、")}`);
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
