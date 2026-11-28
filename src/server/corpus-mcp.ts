import "@tanstack/react-start/server-only";
import {
	type CallToolResult,
	createMcpHandler,
	McpServer,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { deriveAnswer } from "#/corpus/derive-requests";
import { PLACEMENT_SCHEMA } from "#/corpus/vocabulary-rules";
import {
	DERIVE_BODY_BYTES,
	deriveOptions,
	deriveSubmission,
	readDeriveBatch,
	submitDeriveBatch,
} from "./derive-api";
import {
	pending,
	REVIEW_BODY_BYTES,
	reviewReceipt,
	submitReviewTool,
} from "./review";

function toolResult(
	body: Record<string, unknown>,
	isError = false,
): CallToolResult {
	return {
		isError,
		structuredContent: body,
		content: [{ type: "text", text: JSON.stringify(body) }],
	};
}

function toolFailure(error: unknown): CallToolResult {
	console.error("语料 MCP 工具调用失败", error);
	return toolResult(
		{ status: "failed", error: "数据处理失败，请查看服务端日志" },
		true,
	);
}

const id = z.int32().positive();
type Caller =
	| { builtin: { model: string; skipped: Set<number> }; schedule?: never }
	| { builtin?: never; schedule: () => Promise<unknown> };

function deriveServer({ builtin, schedule }: Caller) {
	const server = new McpServer({
		name: "talent-search-derive",
		version: "1.0.0",
	});
	server.registerTool(
		"derive_list",
		{
			description:
				"取一批待抽取能力（extract）或对齐序列（align）的外部经历。按返回的 instructions 与 schema 作答。inputs 为空表示当前这一类没有待办。多个处理方可约定同一 parts，各取不同的 part（从 0 开始）。",
			inputSchema: deriveOptions,
		},
		(query) => readDeriveBatch(query, !builtin).then(toolResult, toolFailure),
	);
	server.registerTool(
		"derive_submit",
		{
			description:
				"交回同一批的 kind、standard 和逐项结果，result 使用取任务时给出的回答格式。只有已尝试且确实无法处理的项才交 unable。逐项检查回执，invalid 可修正，expired 需重新取题，conflict 表示已有另一份结果。",
			inputSchema: deriveSubmission(
				deriveAnswer(z.record(z.string(), z.unknown())),
			),
		},
		(batch) =>
			submitDeriveBatch(batch, schedule, builtin?.model).then(
				toolResult,
				toolFailure,
			),
	);
	return server;
}

function reviewServer({ builtin, schedule }: Caller) {
	const server = new McpServer({
		name: "talent-search-review",
		version: "1.0.0",
	});
	server.registerTool(
		"review_list",
		{
			description:
				"取一批待判词及其人数、参考词和当批指南 guide。逐词按指南作答。words 为空表示当前没有待判词。",
			inputSchema: z.object({ limit: z.int().min(1).max(100).optional() }),
		},
		({ limit }) =>
			pending(limit, builtin && [...builtin.skipped]).then(
				toolResult,
				toolFailure,
			),
	);
	server.registerTool(
		"review_submit",
		{
			description:
				"交回一个词的判定。照抄取题时的 id 和 guideIdentity，judge 填判定方的短标识，judgment 按 guide 作答。收到 accepted 后由整理任务应用。invalid 可修正，taken 表示已有判定，missing 表示题目已失效。",
			inputSchema: z.object({
				id,
				guideIdentity: z.string().regex(/^[a-f0-9]{64}$/),
				judge: z.string(),
				judgment: PLACEMENT_SCHEMA,
			}),
		},
		(input) =>
			submitReviewTool(input, builtin?.model, schedule)
				.then(reviewReceipt)
				.then(
					(receipt) => toolResult(receipt, "error" in receipt),
					toolFailure,
				),
	);
	return server;
}

/** 内置处理器的身份由进程内调用方提供，远程请求只能使用各自的外部凭据。 */
export function createCorpusMcp(scope: "derive" | "review", caller: Caller) {
	return createMcpHandler(
		() => (scope === "derive" ? deriveServer(caller) : reviewServer(caller)),
		{
			maxRequestBodySize:
				scope === "derive" ? DERIVE_BODY_BYTES : REVIEW_BODY_BYTES,
			responseMode: "sse",
		},
	);
}
