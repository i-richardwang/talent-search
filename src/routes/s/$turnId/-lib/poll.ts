/** 进度轮询串行执行；临时读取失败后继续，返回 false 或取消时停止。 */
export function poll(
	interval: number,
	read: (signal: AbortSignal) => Promise<boolean>,
): () => void {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout>;
	async function tick() {
		let again = true;
		try {
			again = await read(controller.signal);
		} catch {
			// 进度读取失败不代表服务端任务失败，下一轮继续读取。
		}
		if (again && !controller.signal.aborted) timer = setTimeout(tick, interval);
	}
	timer = setTimeout(tick, interval);
	return () => {
		controller.abort();
		clearTimeout(timer);
	};
}
