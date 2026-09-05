import { dots } from "#/lib/format";
import {
	DIM_KEYS,
	dimId,
	dimPicked,
	dimText,
	dropValue,
} from "#/search/dimensions";
import type { SearchScope } from "#/search/spec";

/**
 * 查询范围在屏幕上的样子：一个取值一枚标签，各自可以单独摘掉。
 *
 * 怎么念归维度自己声明（`dimensions.ts` 的 `text`），这里只管把一份范围摊成
 * 一行行标签，并且**顺手给出摘掉它之后的那份范围**——由界面自己去 `delete` 一个
 * 键的话，集合维就只能整维一起摘，而屏幕上明明是一枚一枚画的。
 */
export function scopeEntries(scope: SearchScope) {
	const out: { id: string; label: string; without: SearchScope }[] = [];
	for (const key of DIM_KEYS)
		for (const value of dimPicked(scope[key]))
			out.push({
				id: `${key}:${dimId(key, value)}`,
				label: dimText(key, value),
				without: dropValue(scope, key, value),
			});
	// 公司名 / 学校名是另一类：自由文本、没有候选列表，念法也只有这一处用得上
	if (scope.org)
		out.push({
			id: "org",
			label: dots("组织", scope.org),
			without: { ...scope, org: undefined },
		});
	if (scope.school)
		out.push({
			id: "school",
			label: dots("学校", scope.school),
			without: { ...scope, school: undefined },
		});
	return out;
}
