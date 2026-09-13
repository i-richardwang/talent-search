/**
 * 手敲查询的一行语法。它是**输入便利**，不是查询的表示：查询在库里、在 RPC 上、
 * 在屏幕上只有 `Condition[]` 这一种形状，产品里没有任何一处读或写这行字。
 * 用它的是命令行（`scripts/query.ts`）、验收用例（`scripts/eval.ts`）和测试
 * 夹具——那几处要一口气写下几条条件，一行字比一段 JSON 顺手。
 *
 *     大模型/推荐系统 kind:external companyTag:大厂 minMonths:36,-实习,+org:字节,+level:D7/D8
 *
 * 半角逗号隔开**条件**（AND），空格隔开一条条件里带 `键:` 的**各项**（同一段
 * 经历），`/` 隔开一项里的**取值**（OR）。条件开头的 `+` `-` 是强度、`~` 是停用
 * （叠在强度符号前面）。没有 `键:` 的字是经历词——几段没有键的字连起来算一个
 * 词（「machine learning」），所以经历词写在一起；`org:` `companyTag:` `kind:`
 * `minMonths:` 是经历主张的其余几项；`level:` `education:` `recruitment:` `school:`
 * 是人的条件，一条只有它自己。除此之外没有别的语法：一个取值就是那几个字本身，
 * 不切词、不剥句式——自然语言由模型翻译（`intent.ts`），这里只认记号。
 */
import {
	type Condition,
	conditionsOf,
	type Mode,
	PERSON_FIELDS,
} from "./condition";

const MODE_SIGN: Record<string, Mode> = {
	"+": "boost",
	"-": "exclude",
};
const OFF_SIGN = "~";
const KEY_SPLIT = ":";
const CONDITION_SPLIT = ",";
const PART_SPLIT = /\s+/;
const VALUE_SPLIT = "/";

const EXPERIENCE_KEYS = ["org", "companyTag", "kind", "minMonths"] as const;

/** 一行查询 → 条件。收窄（词长、去重、条数）由 `conditionsOf` 做。 */
export function parseQuery(text: string): Condition[] {
	const drafts = text.split(CONDITION_SPLIT).map((group) => {
		let g = group.trim();
		const off = g.startsWith(OFF_SIGN);
		if (off) g = g.slice(1).trim();
		const mode = MODE_SIGN[g[0] ?? ""] ?? "must";
		if (mode !== "must") g = g.slice(1).trim();

		const draft: Record<string, unknown> = { about: "experience", mode };
		const words: string[] = [];
		for (const part of g.split(PART_SPLIT).filter(Boolean)) {
			const colon = part.indexOf(KEY_SPLIT);
			const key = colon > 0 ? part.slice(0, colon) : "";
			const values = part.slice(colon + 1).split(VALUE_SPLIT);
			if ((PERSON_FIELDS as readonly string[]).includes(key)) {
				draft.about = "person";
				draft.field = key;
				draft.values = values;
			} else if (key === "kind" || key === "minMonths") draft[key] = values[0];
			else if ((EXPERIENCE_KEYS as readonly string[]).includes(key))
				draft[key] = values;
			else words.push(part);
		}
		if (words.length > 0) draft.what = words.join(" ").split(VALUE_SPLIT);
		return { ...draft, ...(off && { off: "user" }) };
	});
	return conditionsOf(drafts);
}
