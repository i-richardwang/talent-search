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
