import "@tanstack/react-start/server-only";
import { positiveInt } from "./endpoint";

export const READ_BATCH = 160;
export const READ_PARALLEL = 2;
const byteLimit = positiveInt(process.env.LLM_READ_BATCH_BYTES, Infinity);

// 未设置上下文上限时按段数装批，无需预先序列化长原文。
const bytesOf = (value: unknown) =>
	byteLimit === Infinity ? 0 : Buffer.byteLength(JSON.stringify(value));

export type SegmentBatch = {
	criterion: string;
	segments: { n: number; text: string }[];
};

/** 按完整请求 JSON 的 UTF-8 字节数和段数分批。单段超限时完整单发。 */
export function* segmentBatches<
	H extends { criterion: string },
	T extends { text: string },
>(header: H, input: Iterable<T>) {
	const overhead = bytesOf({ ...header, segments: [] });
	let entries: T[] = [];
	let segments: SegmentBatch["segments"] = [];
	let bytes = overhead;
	for (const entry of input) {
		let segment = { n: entries.length + 1, text: entry.text };
		let size = bytesOf(segment);
		if (
			entries.length &&
			(entries.length === READ_BATCH || bytes + 1 + size > byteLimit)
		) {
			yield { batch: { ...header, segments }, entries };
			entries = [];
			segments = [];
			bytes = overhead;
			segment = { n: 1, text: entry.text };
			size = bytesOf(segment);
		}
		bytes += size + (entries.length ? 1 : 0);
		entries.push(entry);
		segments.push(segment);
	}
	if (entries.length) yield { batch: { ...header, segments }, entries };
}
