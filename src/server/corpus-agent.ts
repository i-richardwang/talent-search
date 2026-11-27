import "@tanstack/react-start/server-only";
import {
	Client,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { jsonSchema, tool } from "ai";
import type { Report } from "#/corpus/report";
import {
	alignModel,
	extractModel,
	processWithTools,
	reviewModel,
} from "./chat";
import { createCorpusMcp } from "./corpus-mcp";
import type { readDeriveBatch, submitDeriveBatch } from "./derive-api";
import type { pending } from "./review";

type Kind = "extract" | "align" | "review";
type Tools = Awaited<ReturnType<Client["listTools"]>>["tools"];
type Args = Record<string, unknown>;
type Batch = Awaited<ReturnType<typeof readDeriveBatch | typeof pending>>;
type Receipts = Awaited<ReturnType<typeof submitDeriveBatch>>;
const BATCH_SIZE = 8;

async function call<T>(client: Client, name: string, args: Args) {
	const result = await client.callTool({ name, arguments: args });
	if (result.isError) {
		const block = result.content[0];
		const info = result.structuredContent;
		const reported =
			typeof info === "object" &&
			info !== null &&
			"error" in info &&
			typeof info.error === "string";
		return {
			ok: false as const,
			status: reported && "status" in info ? info.status : undefined,
			error: reported
				? info.error
				: block?.type === "text"
					? block.text
					: "工具调用失败",
		};
	}
	if (!result.structuredContent)
		throw new Error(`MCP 工具 ${name} 缺少结构化回执`);
	return { ok: true as const, body: result.structuredContent as T };
}

/** 工具形状和说明来自 MCP。每段对话只允许交回它实际读到的那一批。 */
async function processBatch(
	client: Client,
	catalog: Tools,
	kind: Kind,
	model: string,
	skipped: Set<number>,
	report: Report,
) {
	const scope = kind === "review" ? "review" : "derive";
	const remaining = new Set<number>();
	const corrections = new Set<number>();
	let batch: Batch | undefined;
	let standard: string | undefined;
	let full = false;
	let processed = 0;

	async function list(args: Args) {
		if (scope === "derive" && args.kind !== kind)
			return { error: `本次处理 ${kind}` };
		if (batch) return batch;
		if (args.part || (args.parts !== undefined && args.parts !== 1))
			return { error: "本轮处理未分片的待办" };
		const limit = Math.min(
			typeof args.limit === "number" ? args.limit : BATCH_SIZE,
			BATCH_SIZE,
		);
		const result = await call<Batch>(client, `${scope}_list`, {
			...args,
			limit,
		});
		if (!result.ok) return { error: result.error };
		batch = result.body;
		const inputs = "words" in batch ? batch.words : batch.inputs;
		standard = "guide" in batch ? batch.guide.identity : batch.standard;
		for (const { id } of inputs) remaining.add(id);
		full = inputs.length === limit;
		return batch;
	}

	async function submit(args: Args) {
		if (!batch) return { error: "请先取题" };
		if ("words" in batch) {
			const id = args.id as number;
			const word = batch.words.find((row) => row.id === id);
			if (!word || args.guideIdentity !== standard)
				return { error: "请用本批待答词的编号和指南版本提交" };
			const result = await call<{ accepted: true }>(
				client,
				"review_submit",
				args,
			);
			if (!result.ok) {
				if (result.status === "missing" || result.status === "taken")
					remaining.delete(id);
				if (result.status === "invalid") {
					if (corrections.has(id)) {
						skipped.add(id);
						remaining.delete(id);
						report("  整理回答不符合领域规则，未保存");
						return { error: "该词留待下一轮，请继续本批其他词。", id };
					}
					corrections.add(id);
					return { error: result.error, retry: id };
				}

				return { error: result.error };
			}
			remaining.delete(id);
			processed++;
			return result.body;
		}
		const batchInputs = new Set(batch.inputs.map((row) => row.id));
		if (
			args.kind !== kind ||
			args.standard !== standard ||
			!Array.isArray(args.results) ||
			!args.results.length ||
			!args.results.every((row) => batchInputs.has(row?.id))
		)
			return { error: "请用本批的任务类型、标准和待答编号提交" };
		const result = await call<Receipts>(client, "derive_submit", args);
		if (!result.ok) return { error: result.error };
		for (const receipt of result.body.results) {
			if (receipt.status === "invalid") continue;
			if (remaining.delete(receipt.id) && receipt.status === "accepted")
				processed++;
		}
		return result.body;
	}

	function bind(name: string, execute: (args: Args) => Promise<unknown>) {
		const def = catalog.find((tool) => tool.name === name);
		if (!def) throw new Error(`语料 MCP 缺少工具 ${name}`);
		return tool({
			description: def.description,
			inputSchema: jsonSchema<Args>(def.inputSchema),
			execute,
		});
	}
	const listName = `${scope}_list`;
	const submitName = `${scope}_submit`;
	const tools = {
		[listName]: bind(listName, list),
		[submitName]: bind(submitName, submit),
	};
	const done = () => batch !== undefined && remaining.size === 0;
	await processWithTools(kind, model, tools, done);
	if (!done())
		throw new Error(`${kind} agent 未完成本批工具调用，已接收的结果保留`);
	if (processed) report(`  ${kind} agent 已提交 ${processed} 项`);
	return full;
}

export async function runCorpusAgent(
	kind: Kind,
	report: Report,
	deadline = Number.POSITIVE_INFINITY,
) {
	const scope = kind === "review" ? "review" : "derive";
	const model =
		kind === "review"
			? reviewModel()
			: kind === "align"
				? alignModel()
				: extractModel();
	const skipped = new Set<number>();
	const server = createCorpusMcp(scope, { builtin: { model, skipped } });
	const client = new Client({ name: "talent-search-agent", version: "1.0.0" });
	// Web 应用和离线 CLI 使用同一个 Streamable HTTP handler。这个 fetch 只在本进程内交付请求。
	const url = new URL(`http://localhost/api/mcp/${scope}`);
	try {
		await client.connect(
			new StreamableHTTPClientTransport(url, {
				fetch: (input, init) => server.fetch(new Request(input, init)),
			}),
		);
		const catalog = await client.listTools();
		do {
			const full = await processBatch(
				client,
				catalog.tools,
				kind,
				model,
				skipped,
				report,
			);
			if (!full) break;
		} while (Date.now() < deadline);
	} finally {
		try {
			await client.close();
		} finally {
			await server.close();
		}
	}
}
