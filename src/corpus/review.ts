/**
 * 整理一轮：清掉按旧标准收的行、让判过的生效、把人指定的范围退回重判、收集没判过的词，
 * 自带模型还要当场判一轮再生效一次，最后按此刻的人数给每一项定名字。过程报出来。
 *
 * 判定和收集共用 review-guide.ts 的指南，只有整理任务能将队列中的答案写入词表。
 */

import "@tanstack/react-start/server-only";
import type { Rejudge } from "#/lib/task";
import { runCorpusAgent } from "#/server/corpus-agent";
import { discardStale, type Judge, openWords } from "./judgment";
import type { Report } from "./report";
import { guideIdentity } from "./review-guide";
import type { CorpusWriter } from "./session";
import {
	applyJudgments,
	collectWords,
	renameItems,
	sendBack,
} from "./vocabulary";

export async function review(
	session: CorpusWriter,
	report: Report,
	judge: Exclude<Judge, "off">,
	rejudge: Rejudge | null,
): Promise<void> {
	const { client, outsideWriter } = session;
	const identity = guideIdentity();
	await discardStale(client, report, identity);
	await applyJudgments(client, report);
	// 退回排在生效之后：队列里已经判完的那一份是退回之前问的，不该把这次退回盖掉
	if (rejudge) await sendBack(client, report, rejudge);
	await collectWords(session, report);
	let failure: { error: unknown } | undefined;
	if (judge === "model") {
		if ((await openWords(client, identity, 1)).length)
			failure = await outsideWriter(() =>
				runCorpusAgent("review", report).then(
					() => undefined,
					(error) => ({ error }),
				),
			);
		await applyJudgments(client, report);
	} else {
		const { rows } = await client.query<{ waiting: number }>(
			"select count(*)::int as waiting from review_word where guide_identity=$1 and judge is null",
			[identity],
		);
		report(`  判定由外部完成，队列里还有 ${rows[0]?.waiting ?? 0} 个词等着判`);
	}
	await renameItems(client, report);
	if (failure) throw failure.error;
}
