import "@tanstack/react-start/server-only";

/**
 * 一个正整数环境变量。缺失、空、非法、非正一律用默认值。
 *
 * 三个端点适配层的超时、并发、输出预算都从这里读：配错一个数不该让整条检索
 * 或整条理解倒下，而各写一份解析的话，「`RERANK_TIMEOUT_MS=0` 到底是永不超时
 * 还是立刻超时」在两个文件里会有两个答案。
 */
export function positiveInt(value: string | undefined, fallback: number) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
