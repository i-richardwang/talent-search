import { dots } from "#/lib/format";
import { type DimUnit, dimOption, dimText } from "#/search/dimensions";
import {
	isScopeDim,
	type ScopeDim,
	scopeUnit,
	type Term,
	type TermMode,
} from "#/search/term";

/**
 * 公司名与学校名怎么称呼。这两维不在 `dimensions.ts` 那张表里（自由文本，没有
 * 候选列表），称呼也只有这一处：chip 上、筛选栏上念的是同一个词。
 */
export const NAME_LABEL = { org: "组织", school: "学校" } as const;

/**
 * 强度写在符号上，不写在颜色上。
 *
 * 全站的色相已经各有其主：绿是受控字段命中、蓝是选中、amber 是要留意的状态。
 * `+` 和 `-` 是搜索框里几十年的老约定，不需要教，也不占用任何一个色相。
 * 「必须」不带符号：它是默认，而默认不该有标记——大多数查询整条都是必须词，
 * 一排 `=` 号只会让人以为那是要读的内容。
 *
 * 减号画的是真正的减号 U+2212，不是 ASCII 的 `-`：它和加号同宽同高，
 * 一列 chip 的符号位才对得齐。
 */
export const MODE_GLYPH: Record<TermMode, string> = {
	must: "",
	boost: "+",
	exclude: "−",
};

/**
 * 一条条件在屏幕上怎么念：它的代表词（`values[0]`）。其余取值收在菜单里
 * （`query-chips.tsx`），chip 上留一个记号说「这里还有」——十档职级全写出来
 * 是一行念不完的字，会把同一排别的条件挤出屏幕。
 *
 * 范围维度带一次维度名（「当前职级 · D8」），维度名怎么写归维度自己声明
 * （`dimensions.ts` 的 `text`）；公司名与学校名归 `NAME_LABEL`。
 */
export function termLabel(term: Term): string {
	const [first] = term.values;
	if (term.field === "experience") return first;
	if (!isScopeDim(term.field)) return dots(NAME_LABEL[term.field], first);
	return dimText(term.field, unitOf(term.field, first));
}

/**
 * 一条条件里的一个取值怎么念。它出现在已经写明了维度的地方（chip 的菜单、
 * 证据行），所以只念取值本身：「D8」，不是「当前职级 · D8」。
 */
export function valueLabel(term: Term, value: string): string {
	if (term.field === "experience" || !isScopeDim(term.field)) return value;
	return dimOption(term.field, unitOf(term.field, value));
}

/**
 * 范围取值是收窄时按维度写下的（`termsOf`），读回来一定读得到。读不到说明
 * 这条记录没经过那道边界，那是要修的数据，不是要念的字。
 */
function unitOf<K extends ScopeDim>(key: K, value: string): DimUnit[K] {
	const unit = scopeUnit(key, value);
	if (unit === undefined) throw new Error(`${key} 上没有取值「${value}」`);
	return unit;
}
