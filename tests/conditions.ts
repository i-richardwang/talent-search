/**
 * 测试里写条件的唯一一套写法：`claim` 是一条经历主张、`person` 是一条人的条件；
 * `asConditions` 把一份筛选写成查询条件——同一个条件下推和内存求值要对得上，
 * 得先能写成两种。
 *
 * 跟段走的两维（经历来源、公司档）并进那条经历主张——主张里的各项说的是同一段
 * 经历，和视图筛选「证据段得满足」是同一个口径；跟人走的三维各成一条人的条件。
 * 序列、能力词、经历时长不在这里：前两者不是条件能写的维度，经历时长在主张上
 * 是累计的，和视图筛选的单段口径不是同一件事。
 */
import type {
	Condition,
	ExperienceCondition,
	PersonCondition,
	PersonDim,
	PersonMode,
} from "#/search/condition";
import type { SearchFilters } from "#/search/result";

type Some = [string, ...string[]];

const some = (value: string | readonly string[]): Some =>
	(typeof value === "string" ? [value] : [...value]) as Some;

/** 一条经历主张：几个经历词，默认必须；别的项从 `over` 上盖。 */
export function claim(
	what: string | readonly string[],
	over: Partial<ExperienceCondition> = {},
): ExperienceCondition {
	return { about: "experience", mode: "must", what: some(what), ...over };
}

/** 一条人的条件：一维几个取值，默认必须。 */
export function person(
	field: PersonCondition["field"],
	values: string | readonly string[],
	mode: PersonMode = "must",
): PersonCondition {
	return { about: "person", mode, field, values: some(values) };
}

const PERSON_DIMS = [
	"level",
	"education",
	"recruitment",
] as const satisfies readonly PersonDim[];

export function asConditions(
	pick: SearchFilters,
	base: ExperienceCondition,
): Condition[] {
	const out: Condition[] = [
		{
			...base,
			...(pick.kind && { kind: pick.kind }),
			...(pick.companyTag?.length && { companyTag: some(pick.companyTag) }),
		},
	];
	for (const field of PERSON_DIMS) {
		const values = pick[field];
		if (values?.length) out.push(person(field, values));
	}
	if (pick.school?.length) out.push(person("school", pick.school));
	if (pick.org?.length)
		out.push({ about: "experience", mode: "must", org: some(pick.org) });
	return out;
}
