/**
 * 手敲查询的一行语法。它是**输入便利**，不是查询的表示：查询在库里、在 RPC 上、
 * 在屏幕上只有 `Term[]` 这一种形状，产品里没有任何一处读或写这行字。
 * 用它的是命令行（`scripts/query.ts`）、验收用例（`scripts/eval.ts`）和测试
 * 夹具——那几处要一口气写下几条条件，一行字比一段 JSON 顺手。
 *
 *     大模型/推荐系统,+带团队/团队管理,~-实习,+org:字节,level:D7/D8
 *
 * 半角逗号隔开**条件**（AND），`/` 隔开一条条件里的**取值**（OR）。条件开头的
 * `+` `-` 是强度、`~` 是停用（叠在强度符号前面）；`字段:` 前缀是在哪一维找，
 * 没有前缀就是经历词。除此之外没有别的语法：一个取值就是那几个字本身，
 * 不切词、不剥句式——自然语言由模型翻译（`intent.ts`），这里只认记号。
 */
import { isScopeField, type TermMode, termsOf } from "./term";

const MODE_SIGN: Record<string, TermMode> = {
	"+": "boost",
	"-": "exclude",
};
const OFF_SIGN = "~";
const FIELD_SPLIT = ":";
const TERM_SPLIT = ",";
const VALUE_SPLIT = "/";

/** 一行查询 → 条件。收窄（词长、去重、条数）由 `termsOf` 做。 */
export function parseQuery(text: string) {
	const drafts = text.split(TERM_SPLIT).map((group) => {
		let g = group.trim();
		const off = g.startsWith(OFF_SIGN);
		if (off) g = g.slice(1).trim();
		const mode = MODE_SIGN[g[0] ?? ""] ?? "must";
		if (mode !== "must") g = g.slice(1);
		const colon = g.indexOf(FIELD_SPLIT);
		const prefix = colon > 0 ? g.slice(0, colon).trim() : "";
		const field = isScopeField(prefix) ? prefix : "experience";
		if (field !== "experience") g = g.slice(colon + 1);
		const values = g.split(VALUE_SPLIT).map((raw) => raw.trim());
		return { field, mode, values, ...(off && { off: "user" }) };
	});
	return termsOf(drafts);
}
