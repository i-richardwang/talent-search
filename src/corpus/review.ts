/**
 * 整理一轮：清掉按旧标准收的行、让判过的生效、把人指定的范围退回重判、收集没判过的词，
 * 自带模型还要当场判一轮再生效一次。过程报出来。
 *
 * 队列和判定方在 `judgment.ts`，标准、校验与写表在 `vocabulary.ts`。整理只写词表，
 * 不碰人身上的词与边。
 */

import "@tanstack/react-start/server-only";
import type { Rejudge } from "#/lib/task";
import { discardStale, type Judge, openWords } from "./judgment";
import type { Report } from "./report";
import type { CorpusClient } from "./session";
import {
	applyJudgments,
	collectWords,
	guideIdentity,
	judgeByModel,
	sendBack,
} from "./vocabulary";

export async function review(
	client: CorpusClient,
	report: Report,
	judge: Exclude<Judge, "off">,
	rejudge: Rejudge | null,
): Promise<void> {
	const identity = guideIdentity();
	await discardStale(client, report, identity);
	await applyJudgments(client, report);
	// 退回排在生效之后：队列里已经判完的那一份是退回之前问的，不该把这次退回盖掉
	if (rejudge) await sendBack(client, report, rejudge);
	await collectWords(client, report);
	if (judge === "model") {
		await judgeByModel(client, report);
		await applyJudgments(client, report);
		return;
	}
	const waiting = await openWords(client, identity);
	report(`  判定由外部完成，队列里还有 ${waiting.length} 个词等着判`);
}
