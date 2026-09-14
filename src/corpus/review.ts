/**
 * 整理一轮：作废过期题、结算答卷、出题，自带模型还要答题再结算一次。过程报出来。
 *
 * 两种题各管各的落表（圈组写 `skill_term`，释义写 `phrase_gloss`），共用一条队列
 * 和一个裁判（`questions.ts`）。整理只写这两张表，不碰人身上的词与边。
 */

import "@tanstack/react-start/server-only";
import { answerGlossesByModel, askGlosses, settleGlosses } from "./gloss";
import { expire, openQuestions, reviewJudge } from "./questions";
import type { Report } from "./report";
import type { CorpusClient } from "./session";
import { answerGroupsByModel, askGroups, settleGroups } from "./vocabulary";

export async function review(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const judge = reviewJudge();
	await expire(client, report);
	await settleGroups(client, report);
	await settleGlosses(client, report);
	await askGroups(client, report);
	await askGlosses(client, report);
	if (judge === "model") {
		await answerGroupsByModel(client, report);
		await answerGlossesByModel(client, report);
		await settleGroups(client, report);
		await settleGlosses(client, report);
		return;
	}
	const waiting = await openQuestions(client);
	report(
		`  判卷归外部（REVIEW_JUDGE=external），队列里 ${waiting.length} 道题等人答`,
	);
}
