/**
 * 四个端点适配层（`embed` / `rerank` / `llm` / `chat`）共用的三样东西：把配置里的
 * 数读出来，给每一次请求设上超时，以及超时之后再试。
 */

import "@tanstack/react-start/server-only";
import { APICallError, RetryError } from "ai";

export function positiveInt(value: string | undefined, fallback: number) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 每次 HTTP 尝试各有一份超时预算。调用方的 signal 与本次超时信号共用，
 * 任一信号触发时中止请求。
 */
export function timeoutFetch(ms: number): typeof fetch {
	return (input, init) => {
		const own = AbortSignal.timeout(ms);
		return fetch(input, {
			...init,
			signal: init?.signal ? AbortSignal.any([init.signal, own]) : own,
		});
	};
}

/**
 * timeoutFetch 触发的超时在此立即重试；429 和 5xx 由 SDK 退避重试。
 * SDK 重试发生在每次 run 内，最坏尝试次数为两个重试循环次数的乘积。
 */
export async function retryingTimeouts<T>(
	retries: number,
	run: () => Promise<T>,
): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await run();
		} catch (error) {
			if (attempt >= retries || !isTimeout(error)) throw error;
		}
	}
}

/**
 * 是不是 `AbortSignal.timeout` 触发的超时。它是一个 `name` 为 `TimeoutError` 的
 * `DOMException`，SDK 原样抛出；万一哪一层包了一次，沿 `cause` 往下找。
 */
function isTimeout(error: unknown): boolean {
	for (let current = error; current instanceof Error; current = current.cause)
		if (current.name === "TimeoutError") return true;
	return false;
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
 * SDK 把连不上包成一个没有状态码的 `APICallError`，重试用尽再包一层 `RetryError`；
 * 超时是 `timeoutFetch` 设的超时触发了。这里沿 `lastError` 和 `cause` 往下找第一个能识别的。
 */
export type EndpointFault = "unreachable" | "rejected";

export function endpointFault(error: unknown): EndpointFault | null {
	const seen = new Set<unknown>();
	let current = error;
	while (current instanceof Error && !seen.has(current)) {
		seen.add(current);
		if (current.name === "TimeoutError") return "unreachable";
		if (APICallError.isInstance(current))
			return current.statusCode === undefined ? "unreachable" : "rejected";
		current = RetryError.isInstance(current)
			? current.lastError
			: current.cause;
	}
	return null;
}
