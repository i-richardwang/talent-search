import { dots, duration } from "#/lib/format";
import { type Condition, type Mode, PERSON_FIELDS } from "#/search/condition";
import { DIMENSIONS, dimOption, dimText, orAbove } from "#/search/dimensions";

/**
 * 入职前公司、公司内部门与学校怎么称呼。这三维不在 `dimensions.ts` 那张表里
 * （自由文本，没有候选列表），称呼也只有这一处：chip 上、筛选栏上用的是同一个词。
 */
export const NAME_LABEL = {
	company: "公司",
	department: "部门",
	school: "学校",
} as const;

/** 按名字包含匹配的三种属性：入职前公司、公司内部门、学校。 */
export type NameField = keyof typeof NAME_LABEL;

/**
 * 这里能按什么搜索：一段经历，加上人的几项条件。整句都搜不了的空态说这一句；
 * 人的条件多一维，这句话跟着长。
 */
export const SEARCHABLE = (() => {
	const person = PERSON_FIELDS.map((field) =>
		field === "school" ? NAME_LABEL.school : DIMENSIONS[field].label,
	);
	const last = person.pop();
	return `按经历、${person.join("、")}和${last}搜索`;
})();

/**
 * 强度的名字。chip 上和句子里都写名字：必须是默认，不写；加分、排除写出来。
 */
export const MODE_NAME: Record<Mode, string> = {
	must: "必须",
	boost: "加分",
	exclude: "排除",
};

/**
 * 一条条件在屏幕上怎么显示。
 *
 * 经历主张按它的表述顺序排列：什么时候、在哪一档、在哪、做过什么、累计多久——
 * 「入职前 · 大厂 · 增长 · 3 年以上」，读起来就是那句话。每一项只写第一个取值：
 * 它是关键词链的条件编译成查询时的标签（`compile.ts`），chip 上一行放得下。
 *
 * 人的条件带一次维度名（「当前职级 · P7」「学历 · 本科及以上」），维度名怎么写
 * 归维度自己声明（`dimensions.ts` 的 `text`）；学校归 `NAME_LABEL`。
 */
export function conditionLabel(condition: Condition): string {
	if (condition.about === "person") {
		if ("atLeast" in condition)
			return dimText(
				condition.field,
				orAbove(condition.field, condition.atLeast),
			);
		const [first] = condition.values;
		return condition.field === "school"
			? dots(NAME_LABEL.school, first)
			: dimText(condition.field, first);
	}
	return dots(
		condition.kind ? dimOption("kind", condition.kind) : null,
		condition.companyTag?.[0],
		condition.company?.[0],
		condition.department?.[0],
		condition.what?.[0],
		condition.minMonths ? `${duration(condition.minMonths)}以上` : null,
	);
}
