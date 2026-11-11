/**
 * 整理一轮：清掉作废和过期的组、让判过的生效、收集新的，自带模型还要当场判一轮再生效
 * 一次。过程报出来。
 *
 * 队列和判定方在 `judgment.ts`，标准、校验与写表在 `vocabulary.ts`。整理只写词表，
 * 不碰人身上的词与边。
 */

import "@tanstack/react-start/server-only";
import { expire, type Judge, openGroups } from "./judgment";
import type { Report } from "./report";
import type { CorpusClient } from "./session";
import {
	applyGroups,
	collectGroups,
	groupIdentity,
	judgeGroupsByModel,
} from "./vocabulary";

export async function review(
	client: CorpusClient,
	report: Report,
	judge: Exclude<Judge, "off">,
): Promise<void> {
	const identity = groupIdentity();
	await expire(client, report, identity);
	await applyGroups(client, report);
	await collectGroups(client, report);
	if (judge === "model") {
		await judgeGroupsByModel(client, report);
		await applyGroups(client, report);
		return;
	}
	const waiting = await openGroups(client, identity);
	report(`  判定由外部完成，队列里还有 ${waiting.length} 组等着判`);
}
