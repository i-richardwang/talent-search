/**
 * 整理一轮：清掉过期的组、让判过的生效、收集新的，自带模型还要当场判一轮再生效
 * 一次。过程报出来。
 *
 * 两种组各管各的落表（归并写 `skill_term`，释义写 `phrase_gloss`），共用一条队列
 * 和一个判定方（`judgment.ts`）。整理只写这两张表，不碰人身上的词与边。
 */

import "@tanstack/react-start/server-only";
import {
	applyGlosses,
	collectGlosses,
	glossIdentity,
	judgeGlossesByModel,
} from "./gloss";
import {
	expire,
	type GuideIdentities,
	type Judge,
	openGroups,
} from "./judgment";
import type { Report } from "./report";
import type { CorpusClient } from "./session";
import {
	applyGroups,
	collectGroups,
	groupIdentity,
	judgeGroupsByModel,
} from "./vocabulary";

export function guideIdentities(): GuideIdentities {
	return { gloss: glossIdentity(), group: groupIdentity() };
}

export async function review(
	client: CorpusClient,
	report: Report,
	judge: Exclude<Judge, "off">,
): Promise<void> {
	const guides = guideIdentities();
	await expire(client, report, guides);
	await applyGroups(client, report);
	await applyGlosses(client, report);
	await collectGroups(client, report);
	await collectGlosses(client, report);
	if (judge === "model") {
		await judgeGroupsByModel(client, report);
		await judgeGlossesByModel(client, report);
		await applyGroups(client, report);
		await applyGlosses(client, report);
		return;
	}
	const waiting = [
		...(await openGroups(client, "group", guides.group)),
		...(await openGroups(client, "gloss", guides.gloss)),
	];
	report(`  判定由外部完成，队列里还有 ${waiting.length} 组等着判`);
}
