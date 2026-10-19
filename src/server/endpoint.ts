/**
 * 四个端点适配层（`embed` / `rerank` / `llm` / `chat`）共用的两样东西：把配置里的
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
 * 一次 HTTP 请求的超时与重试，四个适配层只经过这一处：SDK 的 provider 拿它当
 * `fetch`、调用时 `maxRetries: 0`，重排直接调它。重试的单位是这一个请求，所以
 * 多步对话里第几步超时就只重发第几步，分批嵌入里哪一批超时就只重发哪一批。
 *
 * - 每次尝试各有 `timeoutMs` 的预算，最多重发 `retries` 次。超时的那次已经等满了预算，
 *   立即重发；连不上和 408/409/429/5xx（和 SDK 判定可重试的状态码相同）退避后重发。
 * - 调用方的 signal 触发（整次调用的时限、取消）立即停下，不再重发。
 * - 用尽后交回最后一次的结果：HTTP 错误原样作为应答交给调用方，超时与连不上原样抛出。
 */
export function endpointFetch({
	timeoutMs,
	retries,
}: {
	timeoutMs: number;
	retries: number;
}): typeof fetch {
	return async (input, init) => {
		const caller = init?.signal ?? undefined;
		for (let attempt = 0; ; attempt++) {
			const own = AbortSignal.timeout(timeoutMs);
			const signal = caller ? AbortSignal.any([caller, own]) : own;
			let wait: number;
			try {
				const response = await fetch(input, { ...init, signal });
				if (attempt >= retries || !retryable(response.status)) return response;
				wait = delayOf(response, attempt);
				await response.body?.cancel();
			} catch (error) {
				if (caller?.aborted || attempt >= retries) throw error;
				if (isTimeout(error)) continue;
				// 按 Fetch 标准，请求没发出去（拒绝连接、断网、DNS）一律是 TypeError
				if (!(error instanceof TypeError)) throw error;
				wait = FIRST_DELAY_MS * 2 ** attempt;
			}
			await sleep(wait, caller);
		}
	};
}

function retryable(status: number) {
	return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isTimeout(error: unknown) {
	return error instanceof Error && error.name === "TimeoutError";
}

function delayOf(response: Response, attempt: number) {
	const backoff = FIRST_DELAY_MS * 2 ** attempt;
	const ms = Number.parseFloat(response.headers.get("retry-after-ms") ?? "");
	if (ms >= 0 && ms <= RETRY_AFTER_MAX_MS) return ms;
	const after = response.headers.get("retry-after");
	if (!after) return backoff;
	const seconds = Number.parseFloat(after);
	const wait = Number.isNaN(seconds)
		? Date.parse(after) - Date.now()
		: seconds * 1000;
	return wait >= 0 && wait <= RETRY_AFTER_MAX_MS ? wait : backoff;
}

function sleep(ms: number, signal: AbortSignal | undefined) {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
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
