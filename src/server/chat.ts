import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
	generateText,
	isStepCount,
	type PrepareStepFunction,
	type ToolSet,
} from "ai";
import { endpointPolicy, positiveInt, thinkingSwitch } from "./endpoint";

const BASE_URL = process.env.EXTRACT_BASE_URL?.trim();
const API_KEY = process.env.EXTRACT_API_KEY;

/**
 * 推理模型的思考开关。设了才随请求发出；不设就尊重端点默认值，标准 OpenAI 端点不会收到
 * 它不认的字段。开关没有统一写法，两种都发：`enable_thinking`（SiliconFlow 一类网关）和
 * `thinking.type`（DeepSeek 一类）。只发其中一种时，不认它的端点会照默认带着思考作答。
 */
const ENABLE_THINKING = process.env.EXTRACT_ENABLE_THINKING?.trim();

const TIMEOUT_MS = positiveInt(process.env.EXTRACT_TIMEOUT_MS, 180_000);
/**
 * 瞬时故障最多重试几次，全部尝试共用这一段的 TIMEOUT_MS 总时限。
 */
const RETRIES = 4;

/**
 * 抽取端点是否完整配置。缺少地址或模型名时，解析报告并跳过抽取与对齐，
 * 自述使用原文检索；整理是否运行由 reviewConfigured 单独判断。
 */
export function chatConfigured(): boolean {
	return Boolean(BASE_URL && process.env.EXTRACT_MODEL?.trim());
}

/** 整理模型是否完整配置；它可以单独使用 REVIEW_MODEL，不要求同时开启抽取。 */
export function reviewConfigured(): boolean {
	return Boolean(BASE_URL && reviewModel());
}

export function extractModel(): string {
	return process.env.EXTRACT_MODEL?.trim() ?? "";
}

/** 序列对齐用的模型；不设就用抽取模型。 */
export function alignModel(): string {
	return process.env.ALIGN_MODEL?.trim() || extractModel();
}

/**
 * 词表整理使用抽取端点；未指定整理模型时使用抽取模型。
 */
export function reviewModel(): string {
	return process.env.REVIEW_MODEL?.trim() || extractModel();
}

type ChatEndpoint = "extract" | "align" | "resume";

function settings(endpoint: ChatEndpoint) {
	if (endpoint === "resume")
		return {
			baseURL: process.env.RESUME_BASE_URL?.trim(),
			apiKey: process.env.RESUME_API_KEY,
		};
	const alignURL = process.env.ALIGN_BASE_URL?.trim();
	if (endpoint === "align" && alignURL)
		return { baseURL: alignURL, apiKey: process.env.ALIGN_API_KEY };
	return { baseURL: BASE_URL, apiKey: API_KEY };
}

function getModel(model: string, endpoint: ChatEndpoint) {
	const { baseURL, apiKey } = settings(endpoint);
	if (!baseURL || !model)
		throw new Error(
			"聊天端点未配置：需要调用所需的地址与模型（见 .env.example）",
		);
	return createOpenAICompatible({
		name: "talent-chat",
		baseURL,
		...(apiKey && { apiKey }),
		// 每一次请求各自超时、各自重试（见 `endpoint.ts`）
		fetch: endpointPolicy({ timeoutMs: TIMEOUT_MS, retries: RETRIES }),
		...(endpoint === "resume" ? {} : thinkingSwitch(ENABLE_THINKING)),
	})(model);
}

/** 端点负责工具调用和请求预算，任务的提示词与完成条件由调用方提供。 */
export async function processWithTools(agent: {
	endpoint: ChatEndpoint;
	model: string;
	tools: ToolSet;
	instructions: string;
	prompt: string;
	done: () => boolean;
	maxSteps: number;
	prepareStep?: PrepareStepFunction<ToolSet>;
}) {
	await generateText({
		model: getModel(agent.model, agent.endpoint),
		tools: agent.tools,
		instructions: agent.instructions,
		prompt: agent.prompt,
		temperature: 0,
		maxRetries: 0,
		timeout: TIMEOUT_MS,
		toolChoice: "required",
		toolCallConcurrency: 1,
		prepareStep: agent.prepareStep,
		stopWhen: [agent.done, isStepCount(agent.maxSteps)],
	});
}
