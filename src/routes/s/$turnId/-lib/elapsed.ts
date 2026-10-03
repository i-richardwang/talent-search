import { useEffect, useState } from "react";

/** 等过这么久才写出已等的时长：更短的等待里数字刚出现就消失，只是一闪。 */
export const ELAPSED_SHOW_AFTER_MS = 2100;

/** 一段时长写成几秒、几分几秒。 */
export function lasting(ms: number) {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds} 秒`;
	return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

/**
 * 从 `since` 起过了多少毫秒，每秒更新一次。`since` 为 null 是不知道这件事从哪一刻
 * 开始，从调用处第一次画出来时算起。
 */
export function useElapsed(since: number | null) {
	const [shown] = useState(Date.now);
	const start = since ?? shown;
	const [elapsed, setElapsed] = useState(0);
	useEffect(() => {
		const tick = () => setElapsed(Date.now() - start);
		tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	}, [start]);
	return elapsed;
}
