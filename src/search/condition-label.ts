import { dots, duration } from "#/lib/format";
import type { Condition, Mode, Part } from "#/search/condition";
import { dimOption, dimText } from "#/search/dimensions";

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
 * 「必须」不带符号：它是默认，而默认不该有标记——大多数查询整条都是必须，
 * 一排 `=` 号只会让人以为那是要读的内容。
 *
 * 减号画的是真正的减号 U+2212，不是 ASCII 的 `-`：它和加号同宽同高，
 * 一列 chip 的符号位才对得齐。
 */
export const MODE_GLYPH: Record<Mode, string> = {
	must: "",
	boost: "+",
	exclude: "−",
};

/**
 * 一条条件在屏幕上怎么念。
 *
 * 经历主张按它说的顺序念：什么时候、在哪一档、在哪、做过什么、累计多久——
 * 「入职前 · 大厂 · 增长 · ≥ 3 年」，读起来就是那句话本身。每一项只念第一个
 * 取值，其余收在菜单里（`query-chips.tsx`），chip 上留一个记号说「这里还有」：
 * 十档职级全写出来是一行念不完的字，会把同一排别的条件挤出屏幕。
 *
 * 人的条件带一次维度名（「当前职级 · D8」），维度名怎么写归维度自己声明
 * （`dimensions.ts` 的 `text`）；学校归 `NAME_LABEL`。
 */
export function conditionLabel(condition: Condition): string {
	if (condition.about === "person") {
		const [first] = condition.values;
		return condition.field === "school"
			? dots(NAME_LABEL.school, first)
			: dimText(condition.field, first);
	}
	return dots(
		condition.kind ? dimOption("kind", condition.kind) : null,
		condition.companyTag?.[0],
		condition.org?.[0],
		condition.what?.[0],
		condition.minMonths ? `≥ ${duration(condition.minMonths)}` : null,
	);
}

/**
 * 一条主张在证据行上的名字：代表词。没有经历词的主张（「待过字节」）没有词，
 * 就念它本身——证据行那一列窄，念不下整句。
 */
export function claimName(condition: Condition): string {
	return condition.about === "experience" && condition.what
		? condition.what[0]
		: conditionLabel(condition);
}

/** chip 上要不要那个「还有别的取值」的记号：哪一项有第二个取值都算。 */
export function hasMore(condition: Condition): boolean {
	if (condition.about === "person") return condition.values.length > 1;
	return [condition.what, condition.org, condition.companyTag].some(
		(list) => (list?.length ?? 0) > 1,
	);
}

/**
 * 一条条件里的一项怎么念。它出现在已经写明了是哪条条件的地方（chip 的菜单），
 * 所以只念这一项本身：「D8」，不是「当前职级 · D8」；月数念成「累计 ≥ 3 年」，
 * 好让它和旁边的经历词分得开。
 */
export function partLabel(condition: Condition, part: Part): string {
	switch (part.key) {
		case "values":
			return condition.about === "person" && condition.field !== "school"
				? dimOption(condition.field, part.value)
				: part.value;
		case "companyTag":
			return dimOption("companyTag", part.value);
		case "kind":
			return dimOption("kind", part.value);
		case "minMonths":
			return `累计 ≥ ${duration(part.value)}`;
		default:
			return part.value;
	}
}
