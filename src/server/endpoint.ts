/**
 * 三个端点适配层（`embed` / `llm` / `chat`）共用的两样东西：把配置里的
 * 数读出来，以及每一次 HTTP 请求的超时与重试。
 */

import "@tanstack/react-start/server-only";
import { APICallError } from "ai";

export function positiveInt(value: string | undefined, fallback: number) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** 退避从 2 秒起、每次翻倍；`Retry-After` 在 60 秒内时照它等。和 AI SDK 的默认一致。 */
const FIRST_DELAY_MS = 2_000;
const RETRY_AFTER_MAX_MS = 60_000;

/**
 * 一次 HTTP 请求的执行策略：`fetch` 负责超时和重试，`limitMs` 是包含全部尝试和退避的总时限。
 * SDK 的 provider 使用这份 `fetch`、调用时 `maxRetries: 0`。重试的单位是这一个请求，所以
 * 多步对话里第几步超时就只重发第几步，分批嵌入里哪一批超时就只重发哪一批。
 *
 * - 每次尝试各有 `timeoutMs` 的预算，最多重发 `retries` 次。超时的那次已经等满了预算，
 *   立即重发；连不上和 408/409/429/5xx（和 SDK 判定可重试的状态码相同）退避后重发。
 * - 调用方的 signal 触发（整次调用的时限、取消）立即停下，不再重发。
 * - 用尽后交回最后一次的结果：HTTP 错误原样作为应答交给调用方，超时与连不上原样抛出。
 */
export function endpointPolicy({
	timeoutMs,
	retries,
}: {
	timeoutMs: number;
	retries: number;
}): { fetch: typeof fetch; limitMs: number } {
	let limitMs = timeoutMs;
	for (let attempt = 0; attempt < retries; attempt++)
		limitMs += timeoutMs + Math.max(RETRY_AFTER_MAX_MS, backoff(attempt));
	const request: typeof fetch = async (input, init) => {
		const caller = init?.signal ?? undefined;
		const deadline = AbortSignal.timeout(limitMs);
		const lifetime = caller ? AbortSignal.any([caller, deadline]) : deadline;
		for (let attempt = 0; ; attempt++) {
			lifetime.throwIfAborted();
			const own = AbortSignal.timeout(timeoutMs);
			const signal = AbortSignal.any([lifetime, own]);
			let wait: number;
			try {
				const response = await fetch(input, { ...init, signal });
				if (attempt >= retries || !retryable(response.status)) return response;
				wait = delayOf(response, attempt);
				await response.body?.cancel();
			} catch (error) {
				if (lifetime.aborted || attempt >= retries) throw error;
				if (isTimeout(error)) continue;
				// 按 Fetch 标准，请求没发出去（拒绝连接、断网、DNS）一律是 TypeError
				if (!(error instanceof TypeError)) throw error;
				wait = backoff(attempt);
			}
			await sleep(wait, lifetime);
		}
	};
	return { fetch: request, limitMs };
}

function backoff(attempt: number): number {
	return FIRST_DELAY_MS * 2 ** attempt;
}

function retryable(status: number) {
	return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isTimeout(error: unknown) {
	return error instanceof Error && error.name === "TimeoutError";
}

function delayOf(response: Response, attempt: number) {
	const fallback = backoff(attempt);
	const ms = Number.parseFloat(response.headers.get("retry-after-ms") ?? "");
	if (ms >= 0 && ms <= RETRY_AFTER_MAX_MS) return ms;
	const after = response.headers.get("retry-after");
	if (!after) return fallback;
	const seconds = Number.parseFloat(after);
	const wait = Number.isNaN(seconds)
		? Date.parse(after) - Date.now()
		: seconds * 1000;
	return wait >= 0 && wait <= RETRY_AFTER_MAX_MS ? wait : fallback;
}

async function sleep(ms: number, signal: AbortSignal | undefined) {
	let abort: (() => void) | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			if (signal?.aborted) return reject(signal.reason);
			const timer = setTimeout(resolve, ms);
			abort = () => {
				clearTimeout(timer);
				reject(signal?.reason);
			};
			signal?.addEventListener("abort", abort, { once: true });
		});
	} finally {
		if (abort) signal?.removeEventListener("abort", abort);
	}
}

/**
 * 一通调用失败时，端点那一侧出了什么事：
 *
 * - `unreachable`：没答上来——连不上（DNS、拒绝连接、断网）或每一次尝试都超时。
 *   请求根本没被读过。
 * - `rejected`：答了，答的是一个 HTTP 错误——鉴权、模型名、额度、网关自己坏了。
 *
 * 都不是就是 null：端点好好地答了，问题出在答的内容或我们自己这一侧。
 *
 * 超时是 `TimeoutError`（单次尝试的，或整次调用的时限）；SDK 把连不上包成没有状态码的
 * `APICallError`，把 HTTP 错误包成带状态码的。这里沿 `cause` 往下找第一个能识别的。
 */
export type EndpointFault = "unreachable" | "rejected";

export function endpointFault(error: unknown): EndpointFault | null {
	for (let current = error; current instanceof Error; current = current.cause) {
		if (current.name === "TimeoutError") return "unreachable";
		if (APICallError.isInstance(current))
			return current.statusCode === undefined ? "unreachable" : "rejected";
	}
	return null;
}

/**
 * 思考开关写进 provider 的配置。它是网关自己的字段，兼容层的选项里没有，只能在请求体成形之后
 * 补上；没设置时不动请求体。
 */
export function thinkingSwitch(setting: string | undefined) {
	if (!setting) return {};
	const on = setting === "true";
	return {
		transformRequestBody: (body: Record<string, unknown>) => ({
			...body,
			enable_thinking: on,
			thinking: { type: on ? "enabled" : "disabled" },
		}),
	};
}
