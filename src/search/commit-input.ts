/**
 * RPC 查询写入边界的纯校验：不可信入参转换为完整的 QueryInput。
 */

import { type QueryInput, sanitizeSpec } from "./spec";
import { boundedText } from "./text";

/**
 * 校验原话、完整条件表与基线记录 id；显式空表合法，非空但全部无效的表拒绝。
 */
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
	const raw = input.spec as { conditions?: unknown } | null | undefined;
	if (!Array.isArray(raw?.conditions)) throw new Error("查询格式无效");
	const spec = sanitizeSpec(input.spec);
	if (raw.conditions.length > 0 && spec.conditions.length === 0)
		throw new Error("搜索条件无效");
	return { from, input: { kind: "spec", spec } };
}
