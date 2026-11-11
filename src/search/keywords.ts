/**
 * 关键词模式的查询：几个框里填的词，和它们写成的条件表。
 *
 * 关键词模式无需查询理解，也不调模型：经历词按字面包含匹配。输入框组成完整条件表。一个框只管一维，框里的
 * 每个词是一枚 chip：
 *
 * - **经历或技能**：每个词一条必须主张，词之间是 AND——「推荐」「机器学习」
 *   两样都要。说法里含这个词的经历就算，词表里并成同一项的写法一起算。
 * - **公司**：入职前经历的一条主张，公司名含其中任一个就算，词之间是 OR。
 * - **部门**：公司内任职的一条主张，部门名或部门路径含其中任一个就算，词之间是 OR。
 * - **学校**：一条人的条件，词之间是 OR。
 * - **累计年限**：加在「经历或技能」的每一条主张上，各自累计。没有词时不起作用，
 *   框也不让填。
 *
 * 「在字节做过三年推荐」这种把几项绑在同一段经历上的说法，关键词模式说不出来：
 * 公司和经历是两条条件，只要求同一个人。这是对话模式存在的理由。
 *
 * 条件表是两种模式共用的查询语言（`condition.ts`），这里只是它的一种写法；
 * 写出来的表照样过 `conditionsOf`，和别的入口是同一道校验。
 */
import { dots, duration } from "#/lib/format";
import {
	CONDITION_MAX,
	type Condition,
	conditionsOf,
	type ExperienceCondition,
	MAX_TERM_LEN,
	MIN_TERM_LEN,
	type PersonCondition,
	termOf,
} from "./condition";
import { FILTER_LIST_MAX } from "./dimensions";
import { boundedText, TEXT_MAX } from "./text";

export type Keywords = {
	what: string[];
	company: string[];
	department: string[];
	school: string[];
	/** 累计至少几个月；不限为 null。 */
	minMonths: number | null;
};

export const NO_KEYWORDS: Keywords = {
	what: [],
	company: [],
	department: [],
	school: [],
	minMonths: null,
};

/** 填词的框，按屏幕上的顺序。 */
export const KEYWORD_FIELDS = [
	"what",
	"company",
	"department",
	"school",
] as const;
export type KeywordField = (typeof KEYWORD_FIELDS)[number];

/** 经历词和名称各有长短边界；输入框与候选接口共用。 */
const NAME_RULE = { min: 1, max: TEXT_MAX, parse: boundedText };
export const KEYWORD_RULES = {
	what: { min: MIN_TERM_LEN, max: MAX_TERM_LEN, parse: termOf },
	company: NAME_RULE,
	department: NAME_RULE,
	school: NAME_RULE,
};

/** 输入边界拒绝超长值，不把名称或经历词截成另一种写法。 */
export function parseKeyword(field: KeywordField, input: string) {
	const rule = KEYWORD_RULES[field];
	return input.trim().length <= rule.max ? rule.parse(input) : undefined;
}

/** 每个经历词占一条条件；同一维的所有名称共用一条条件。 */
export function keywordLimit(k: Keywords, field: KeywordField): number {
	const names = KEYWORD_FIELDS.filter(
		(key) => key !== "what" && k[key].length > 0,
	).length;
	if (field === "what") return CONDITION_MAX - names;
	return k[field].length || k.what.length + names < CONDITION_MAX
		? FILTER_LIST_MAX
		: 0;
}

/** 空输入或重复值保持原表；无效或超容量的输入返回 null，调用方必须保留草稿。 */
export function addKeyword(
	k: Keywords,
	field: KeywordField,
	input: string,
): string[] | null {
	const values = k[field];
	if (!input.trim()) return values;
	const value = parseKeyword(field, input);
	if (!value) return null;
	if (values.includes(value)) return values;
	return values.length < keywordLimit(k, field) ? [...values, value] : null;
}

/** 提交包含所有框的未确认输入；任意一框无法接纳时整次提交无效。 */
export function applyKeywordDrafts(
	keywords: Keywords,
	drafts: Partial<Record<KeywordField, string>>,
): Keywords | null {
	let next = keywords;
	for (const field of KEYWORD_FIELDS) {
		const values = addKeyword(next, field, drafts[field] ?? "");
		if (values === null) return null;
		next = { ...next, [field]: values };
	}
	return next;
}

export const KEYWORD_LABEL: Record<KeywordField, string> = {
	what: "经历或技能",
	company: "公司",
	department: "部门",
	school: "学校",
};

/** 框里的词 → 条件表。校验之后一条不剩就是什么都没填。 */
export function conditionsOfKeywords(k: Keywords): Condition[] {
	return conditionsOf([
		...k.what.map((term) => ({
			about: "experience",
			mode: "must",
			what: [term],
			minMonths: k.minMonths ?? undefined,
		})),
		{ about: "experience", mode: "must", company: k.company },
		{ about: "experience", mode: "must", department: k.department },
		{ about: "person", mode: "must", field: "school", values: k.school },
	]);
}

const isWhat = (
	c: Condition,
): c is ExperienceCondition & { what: readonly [string] } =>
	c.about === "experience" &&
	c.mode === "must" &&
	c.what?.length === 1 &&
	!c.company &&
	!c.department &&
	!c.companyTag &&
	!c.kind;

/** 只写了这一项名字的必须主张：公司框或部门框写出的那一条。 */
const onlyNames =
	<F extends "company" | "department">(field: F) =>
	(
		c: Condition,
	): c is ExperienceCondition & Required<Pick<ExperienceCondition, F>> =>
		c.about === "experience" &&
		c.mode === "must" &&
		Object.keys(c).sort().join() === ["about", "mode", field].sort().join();

const isSchool = (c: Condition): c is PersonCondition & { field: "school" } =>
	c.about === "person" && c.mode === "must" && c.field === "school";

/**
 * 条件表 → 框里的词：关键词搜索的结果页把当前的查询填回框里，接着改。
 *
 * 只有 `conditionsOfKeywords` 写得出的表才读得回来，别的形状返回 null。
 * 关键词搜索的链只由这几个框写（`server/turn.ts` 拦着别的写法），
 * 读不回来说明记录不是这样来的，不能拿一份删掉几条的框冒充它。
 */
export function keywordsOf(conditions: readonly Condition[]): Keywords | null {
	// 框里没有停用：停用的一条填回框里就成了启用的
	if (conditions.some((c) => c.off)) return null;
	const what = conditions.filter(isWhat);
	const company = conditions.filter(onlyNames("company"));
	const department = conditions.filter(onlyNames("department"));
	const school = conditions.filter(isSchool);
	if (
		what.length + company.length + department.length + school.length !==
		conditions.length
	)
		return null;
	if (company.length > 1 || department.length > 1 || school.length > 1)
		return null;
	const months = new Set(what.map((c) => c.minMonths ?? null));
	if (months.size > 1) return null;
	return {
		what: what.map((c) => c.what[0]),
		company: [...(company[0]?.company ?? [])],
		department: [...(department[0]?.department ?? [])],
		school: [...(school[0]?.values ?? [])],
		minMonths: [...months][0] ?? null,
	};
}

/**
 * 一次关键词搜索叫什么：框里的词按框的顺序排开。对话的任务拿链头那句话当标题，
 * 关键词没有那句话，词就是它问的——吸顶那条和「最近搜索」都读这一份。
 */
export function keywordTitle(k: Keywords): string {
	return dots(
		k.what.join("、") || null,
		k.company.join("、") || null,
		k.department.join("、") || null,
		k.school.join("、") || null,
		k.minMonths && k.what.length > 0
			? `累计 ${duration(k.minMonths)}以上`
			: null,
	);
}
