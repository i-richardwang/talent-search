/**
 * 四个端点适配层（`embed` / `rerank` / `llm` / `chat`）共用的三样东西：把配置里的
 * 数读出来，给每一次请求设上超时，以及超时之后再试。
 */

import "@tanstack/react-start/server-only";
import { APICallError, RetryError } from "ai";

/**
 * 一个正整数环境变量。缺失、空、非法、非正一律用默认值。
 *
 * 配错一个数不该让整条检索或整条理解倒下，而各写一份解析的话，
 * 「`RERANK_TIMEOUT_MS=0` 到底是永不超时还是立刻超时」在四个文件里会有四个答案。
 */
export function positiveInt(value: string | undefined, fallback: number) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 给每一次 HTTP 请求设上超时的 `fetch`。四个 `*_TIMEOUT_MS` 因此是同一个意思：
 * **一次尝试最多等多久**。
 *
 * 超时是一次请求的属性，不是一通调用的属性：设在整通调用上（AI SDK 的 `timeout`
 * 数字是 `totalMs`，`abortSignal` 同样跨越全部尝试）时，第一次尝试超时就把整通
 * 调用连同它的重试一起中止了。设在这一层，每一次尝试各拿一份完整的预算。
 *
 * 调用方传进来的 signal 仍然管用：两个信号取并集，哪个先触发就按哪个中止。
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
 * 超时了就再试，最多 `retries` 次。
 *
 * 重试分两个循环，各管一类错误，互不重叠：
 *
 * - **端点答了、答的是可重试的错**（429、5xx）——AI SDK 的 `maxRetries` 管，
 *   指数退避、遵守 `Retry-After`；
 * - **端点没答上来**（`timeoutFetch` 中止了这一次）——这里管。SDK 把中止一律
 *   当成调用方不想要了，直接抛、一次都不试，而这里的中止来自我们自己设的超时，
 *   它说的是「端点这一次太慢」，恰恰是最该再试一次的那类失败。
 *
 * 超时之前已经等满了一份预算，所以不再退避，立刻重来。SDK 里的重试发生在
 * 一次 `run` 之内，两个循环相乘的最坏次数由调用方给的两个 `retries` 决定。
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
