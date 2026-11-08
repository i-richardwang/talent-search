/**
 * 测试里写条件的唯一一套写法：`claim` 是一条经历主张、`person` 是一条人的条件；
 * `asConditions` 把一份筛选写成查询条件——同一个条件下推和内存求值要对得上，
 * 得先能写成两种。
 *
 * 跟段走的两维（经历来源、公司档）并进那条经历主张——主张里的各项说的是同一段
 * 经历，和视图筛选「证据段得满足」是同一条规则；跟人走的三维各成一条人的条件。
 * 序列、能力词、经历时长不在这里：前两者不是条件能写的维度，经历时长在主张上
 * 是累计的，和视图筛选的单段算法不是同一件事。
 */

import { compileCondition } from "#/search/compile";
import type {
	Condition,
	ExperienceCondition,
	PersonCondition,
	PersonDim,
	PersonMode,
} from "#/search/condition";
import type { SearchFilters } from "#/search/params";
import { type Claim, isClaim } from "#/search/query";

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

/** 同一条经历主张编译成查询里的主张：排名、证据和空态读的是这一种。 */
export function compiledClaim(
	what: string | readonly string[],
	over: Partial<ExperienceCondition> = {},
): Claim {
	const c = compileCondition(claim(what, over));
	if (!isClaim(c)) throw new Error("写的不是一条经历主张");
	return c;
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
	"schoolTier",
	"overseas",
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
	if (pick.company?.length)
		out.push({
			about: "experience",
			mode: "must",
			company: some(pick.company),
		});
	if (pick.department?.length)
		out.push({
			about: "experience",
			mode: "must",
			department: some(pick.department),
		});
	return out;
}

/** 模型交上来的一条人的条件，`where` 调了白名单外的函数：编不过，怎么重交提交检查都不收。 */
export const sleeper = {
	label: "睡一会儿",
	mode: "must",
	from: "person",
	where: "pg_sleep(1) is not null",
};

/** 模型交上来的一条人的条件，编得过、执行才报错：`:days` 传的「九十」转不成日期差。 */
export const lately = {
	label: "最近有过绩效",
	mode: "must",
	from: "person",
	where:
		"exists (select 1 from rating r where r.emp_id = p.emp_id and r.period_end >= current_date - :days)",
	params: { days: "九十" },
};
