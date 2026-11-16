/**
 * 一次找人任务到这一句话之前的经过，写成给查询理解读的几行字：HR 每一轮说了什么或直接改了
 * 什么，条件因此加了什么、去掉了什么，AI 对 HR 说过什么、问过什么。查询理解靠它读懂这一句话
 * 接的是哪一句（「不是这个意思」「按第二种」）；条件本身仍以当前的条件表为准。
 *
 * 只写标签和原话，不写 `where` 和判据：那些在当前的条件表里是完整的。读过的经历不在这里，
 * 它们的结论存在库里（`server/judged.ts`）。
 */
import type { TurnNotes } from "./intent";
import { labelsInSentence, type QueryCondition } from "./query";
import { changesOf, sameConditions } from "./spec";

/** 链上已经处理完的一轮。 */
export type PastTurn = {
	/** 这一轮说的话；HR 直接改条件的一轮为 null。 */
	said: string | null;
	conditions: readonly QueryCondition[];
	notes: TurnNotes | null;
};

/**
 * 最多写几轮：第一句话（这次任务要找什么）和最近的几轮。再早的经过对读懂这一句话帮助有限，
 * 一次任务聊得再久，请求也不随它无限变长。
 */
const HISTORY_MAX = 12;

function changed(
	base: readonly QueryCondition[],
	next: readonly QueryCondition[],
): string | null {
	const { added, removed } = changesOf(base, next);
	const parts = [
		added.length > 0 ? `加上 ${labelsInSentence(added)}` : null,
		removed.length > 0 ? `去掉 ${labelsInSentence(removed)}` : null,
	].filter((part) => part !== null);
	return parts.length > 0 ? parts.join("；") : null;
}

function spoken({ says, choices }: TurnNotes): string {
	if (!choices) return `对 HR 说：${says}`;
	const answers = choices.others.map((o) => `「${o.label}」`).join("、");
	return `问 HR：${says} 当时按的是「${choices.current}」，HR 还可以回答${answers}`;
}

function lineOf(turn: PastTurn, base: readonly QueryCondition[] | null) {
	const conditions = turn.conditions;
	if (turn.said === null) {
		if (base && sameConditions(base, conditions))
			return "HR 让你按原样的条件接着往下找。";
		const what = changed(base ?? [], conditions);
		return what
			? `HR 自己改了条件：${what}。`
			: "HR 自己停用或启用了几条条件。";
	}
	const did = base
		? (changed(base, conditions) ?? "条件没变")
		: conditions.length > 0
			? `按这些条件找：${labelsInSentence(conditions)}`
			: "没有整理出条件";
	return [
		`HR：${turn.said}`,
		`你：${did}。${turn.notes ? spoken(turn.notes) : ""}`,
	].join("\n");
}

/** 之前几轮的经过，一轮一段，从早到晚；这是第一句话时为空。 */
export function historyLines(past: readonly PastTurn[]): string[] {
	const lines = past.map((turn, i) =>
		lineOf(turn, i > 0 ? (past[i - 1]?.conditions ?? null) : null),
	);
	if (lines.length <= HISTORY_MAX) return lines;
	const skipped = lines.length - HISTORY_MAX;
	return [
		...lines.slice(0, 1),
		`（中间 ${skipped} 轮从略）`,
		...lines.slice(skipped + 1),
	];
}
