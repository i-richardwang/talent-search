/** 有界并发：首个失败停止领取工作，已领取的工作收尾后才交回错误。 */
export async function concurrently<T>(
	items: readonly T[],
	limit: number,
	work: (item: T, stopped: AbortSignal) => Promise<void>,
): Promise<void> {
	const stop = new AbortController();
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			try {
				while (!stop.signal.aborted && next < items.length) {
					const item = items[next++];
					if (item !== undefined) await work(item, stop.signal);
				}
			} catch (error) {
				if (!stop.signal.aborted) stop.abort(error);
			}
		}),
	);
	if (stop.signal.aborted) throw stop.signal.reason;
}

/**
 * 同一时刻最多放行 `limit` 件事的闸：多出来的按先后排队。调用方各不相干（不同的请求、不同的
 * 人）而共用同一个下游上限时用它。
 */
export function gate(limit: number) {
	let running = 0;
	const waiting: (() => void)[] = [];
	return async <T>(work: () => Promise<T>): Promise<T> => {
		if (running >= limit)
			await new Promise<void>((resolve) => waiting.push(resolve));
		else running++;
		try {
			return await work();
		} finally {
			// 有人在等就把这个名额直接交给他，没有才归还
			const next = waiting.shift();
			if (next) next();
			else running--;
		}
	};
}
