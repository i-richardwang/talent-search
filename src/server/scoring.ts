/** 为入围者在已满足主张上的证据评分。模型调用在读取语料的事务结束后进行。 */
import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { concurrently } from "#/lib/concurrent";
import { withSearchFacts } from "#/search/execute";
import { type Query, rolesOf } from "#/search/query";
import { readSegmentTexts, savedScores, saveScores } from "./judged";
import { scoreSegments } from "./llm";
import type { RecordStep } from "./reading";
import { READ_PARALLEL, segmentBatches } from "./segment-batches";

/** 评分端点未能交出完整分数，已经确认的名单仍可发布。 */
export class ScoreUnavailable extends Error {}

type Rating<T> = { item: T; score: number };

/** 同一判据下每种文字只占一个编号，每个有效批次交给调用方保存。 */
export async function scoreTexts<T>(
	criterion: string,
	byText: ReadonlyMap<string, T>,
	accept: (ratings: Rating<T>[]) => void | Promise<void>,
	signal?: AbortSignal,
) {
	signal?.throwIfAborted();
	const input = Array.from(byText, ([text, item]) => ({ text, item }));
	const batches = [...segmentBatches({ criterion }, input)];
	await concurrently(
		batches,
		READ_PARALLEL,
		async ({ batch, entries }, stopped) => {
			const scores = await scoreSegments(
				batch,
				signal ? AbortSignal.any([signal, stopped]) : stopped,
			).catch((cause) => {
				signal?.throwIfAborted();
				throw new ScoreUnavailable("未取得完整匹配分", { cause });
			});
			await accept(
				entries.map(({ item }, index) => {
					const score = scores.get(index + 1);
					if (score === undefined) throw new Error("已校验的评分缺少经历编号");
					return { item, score };
				}),
			);
		},
	);
}

type Evidence = { criterion: string; textKey: string; contents: Set<string> };

export async function scoreEvidence(
	query: Query,
	rootTurnId: string,
	record: RecordStep,
	signal?: AbortSignal,
) {
	const { claims } = rolesOf(query);
	if (!claims.some((c) => c.seek.criterion)) return;
	const work = await withSearchFacts(
		query,
		rootTurnId,
		async (store, { ranked, facts }) => {
			const basis = new Map(ranked.map((r) => [r.personId, r.basis]));
			const ids = new Map<string, Set<number>>();
			for (const f of facts) {
				const criterion = claims[f.claim]?.seek.criterion;
				if (
					!criterion ||
					f.matchScore !== null ||
					!basis.get(f.personId)?.[f.claim]
				)
					continue;
				const group = ids.get(criterion) ?? new Set<number>();
				group.add(f.id);
				ids.set(criterion, group);
			}
			if (!ids.size) return null;
			const texts = await readSegmentTexts(store, [
				...new Set([...ids.values()].flatMap((group) => [...group])),
			]);
			const tasks = Array.from(ids, ([criterion, selected]) => {
				const byText = new Map<string, Evidence>();
				for (const id of selected) {
					const segment = texts.get(id);
					if (!segment) throw new Error("已确认的经历缺少评分原文");
					let evidence = byText.get(segment.text);
					if (!evidence) {
						evidence = {
							criterion,
							textKey: createHash("sha256").update(segment.text).digest("hex"),
							contents: new Set(),
						};
						byText.set(segment.text, evidence);
					}
					evidence.contents.add(segment.content);
				}
				return { criterion, byText };
			});
			const cached = await savedScores(
				store,
				rootTurnId,
				tasks.flatMap((task) => [...task.byText.values()]),
			);
			for (const { byText } of tasks)
				for (const [text, item] of byText)
					if (cached.has(item)) byText.delete(text);
			return { tasks, cached };
		},
	);
	if (!work) return;
	const persist = async (ratings: Rating<Evidence>[]) => {
		const updates = ratings.flatMap(({ item, score }) =>
			Array.from(item.contents, (content) => ({
				criterion: item.criterion,
				textKey: item.textKey,
				content,
				score,
			})),
		);
		if (updates.length)
			await record(
				{ at: Date.now(), tool: "score", segments: updates.length },
				(store) => saveScores(rootTurnId, updates, store),
			);
	};
	await persist(Array.from(work.cached, ([item, score]) => ({ item, score })));
	for (const { criterion, byText } of work.tasks)
		await scoreTexts(criterion, byText, persist, signal);
}
