/**
 * 手敲查询的一行语法。它是**输入便利**，不是查询的表示：查询在库里、在 RPC 上、
 * 在屏幕上只有 `Requirement[]` 这一种形状，产品里没有任何一处读或写这行字。
 * 用它的是命令行（`scripts/query.ts`）、验收用例（`scripts/eval.ts`）和测试
 * 夹具——那几处要一口气写下几条要求，一行字比一段 JSON 顺手。
 *
 *     大模型/推荐系统,+带团队,~-实习
 *
 * 半角逗号隔开**要求**（AND），`/` 隔开一条要求里的**说法**（OR），词前的
 * `+` `-` 是强度、`~` 是停用（叠在强度符号前面）。除此之外没有别的语法：
 * 一个说法就是记号后面那几个字本身，不切词、不剥句式、不去停用词——
 * 自然语言由模型翻译（`intent.ts`），这里只认记号。
 */
import {
	type Requirement,
	type RequirementMode,
	requirementsOf,
} from "./requirement";

const MODE_SIGN: Record<string, RequirementMode> = {
	"+": "boost",
	"-": "exclude",
};
const OFF_SIGN = "~";
const REQUIREMENT_SPLIT = ",";
const MEMBER_SPLIT = "/";

/** 一行查询 → 要求。收窄（词长、去重、条数）由 `requirementsOf` 做。 */
export function parseQuery(text: string): Requirement[] {
	const drafts = text.split(REQUIREMENT_SPLIT).map((group) => {
		let g = group.trim();
		const off = g.startsWith(OFF_SIGN);
		if (off) g = g.slice(1).trim();
		const mode = MODE_SIGN[g[0] ?? ""] ?? "must";
		if (mode !== "must") g = g.slice(1);
		return { members: g.split(MEMBER_SPLIT), mode, ...(off && { off: true }) };
	});
	return requirementsOf(drafts);
}
