/**
 * RPC 查询写入边界的纯校验：不可信入参转换为完整的 QueryInput。
 */

import { type QueryInput, sanitizeSpec } from "./spec";
import { boundedText } from "./text";

export function validateCommit(d: unknown): {
	from: string | undefined;
	input: QueryInput;
} {
	const data = (d ?? {}) as Record<string, unknown>;
	const input = (data.input ?? {}) as Record<string, unknown>;
	const from =
		typeof data.from === "string" && data.from ? data.from : undefined;
	if (input.kind === "sentence") {
		const text = boundedText(input.text);
		if (!text) throw new Error("查询为空");
		return { from, input: { kind: "sentence", text } };
	}
	if (input.kind !== "spec") throw new Error("查询格式无效");
	return { from, input: { kind: "spec", spec: sanitizeSpec(input.spec) } };
}
