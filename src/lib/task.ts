/** 语料任务的种类，数据库、调度与管理界面共用。 */
export const TASK_KINDS = ["sync", "derive", "review"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/**
 * 人指定的重新判定范围：一项（一个标准词和它的其他写法，`branch` 再带上它下面的每一层细分）、
 * 判成不是能力的全部词，或整张词表。范围里的词退回成没判过，由这一轮整理重新收集。
 */
export type Rejudge =
	| { scope: "term"; word: string; branch: boolean }
	| { scope: "excluded" }
	| { scope: "all" };

/** 请求和任务载荷里的范围；形状不对的是 null。 */
export function rejudgeOf(raw: unknown): Rejudge | null {
	if (typeof raw !== "object" || raw === null) return null;
	const { scope, word, branch } = raw as Record<string, unknown>;
	if (scope === "excluded" || scope === "all") return { scope };
	if (scope === "term" && typeof word === "string" && word !== "")
		return { branch: branch === true, scope, word };
	return null;
}
