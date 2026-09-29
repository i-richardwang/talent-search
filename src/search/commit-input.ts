/**
 * 提交一次查询时那份不可信入参 → 一条能落库的查询记录输入。
 *
 * 它放在 `search/` 而不是 `server/functions.ts` 里，因为它是**纯函数**：不碰
 * 数据库、不碰密钥，只做校验。放在服务端模块里的话，测它就得先起一个 Postgres
 * 和一个假模型端点——一条校验规则的测试不该有这种代价。
 */

import { hasMeaning, type QueryInput, sanitizeSpec } from "./spec";
import { boundedText } from "./text";

/**
 * 校验放在跨进程的 RPC 入口，不放在 `createTurn` 里：只有从客户端传进来的入参不可信。
 * 整份 `SearchSpec` 在这里一次校验完，没有第二个入口。
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
	const spec = sanitizeSpec(input.spec);
	if (!hasMeaning(spec)) throw new Error("查询为空");
	return { from, input: { kind: "spec", spec } };
}
