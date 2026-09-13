/**
 * 提交一次查询时那份不可信入参 → 一条能落库的查询记录输入。
 *
 * 它住在 `search/` 而不是 `server/functions.ts` 里，因为它是**纯函数**：不碰
 * 数据库、不碰密钥，只做收窄。放在服务端模块里的话，验它就得先起一个 Postgres
 * 和一个假模型端点——一条收窄规则的测试不该有这种代价。
 */

import { hasMeaning, type QueryInput, sanitizeSpec } from "./spec";
import { boundedText } from "./text";

/**
 * 收窄放在跨进程这一跳，不放在 `createTurn` 里：不可信的只有这一跳。
 * 整份 `SearchSpec` 在这里一次收窄，没有第二个入口。
 */
export function validateCommit(d: unknown): {
	parentTurnId: string | undefined;
	input: QueryInput;
} {
	const data = (d ?? {}) as Record<string, unknown>;
	const input = (data.input ?? {}) as Record<string, unknown>;
	const parentTurnId =
		typeof data.parentTurnId === "string" && data.parentTurnId
			? data.parentTurnId
			: undefined;
	if (input.kind === "sentence") {
		const text = boundedText(input.text);
		if (!text) throw new Error("查询为空");
		return { parentTurnId, input: { kind: "sentence", text } };
	}
	if (input.kind !== "spec") throw new Error("查询格式无效");
	const spec = sanitizeSpec(input.spec);
	if (!hasMeaning(spec)) throw new Error("查询为空");
	return { parentTurnId, input: { kind: "spec", spec } };
}
