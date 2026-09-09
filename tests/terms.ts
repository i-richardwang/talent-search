/** 测试里把一份筛选写成查询条件：同一个条件下推和内存求值要对得上，得先能写成两种。 */
import { dimId, dimPicked } from "#/search/dimensions";
import type { SearchFilters } from "#/search/result";
import { isScopeDim, SCOPE_FIELDS, type Term } from "#/search/term";

export function scopeTerms(
	pick: SearchFilters,
	mode: "must" | "boost" = "must",
): Term[] {
	const out: Term[] = [];
	for (const field of SCOPE_FIELDS) {
		if (!isScopeDim(field)) {
			const names = pick[field];
			if (names?.length)
				out.push({ field, mode, values: [...names] as [string, ...string[]] });
			continue;
		}
		const values = dimPicked<typeof field>(pick[field]).map((v) =>
			dimId(field, v),
		);
		const [first, ...rest] = values;
		if (first) out.push({ field, mode, values: [first, ...rest] });
	}
	return out;
}
