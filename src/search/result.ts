import type { Employee, Experience, Route } from "#/db/schema";
import {
	activeConditions,
	type Condition,
	type ExperienceCondition,
	type PersonCondition,
} from "./condition";
import { DIM_KEYS, type DimKey, type Facet } from "./dimensions";
import type { EmptyReason } from "./empty";
import type { Strength } from "./weights";

/** 说了做过什么的经历主张：它决定名次，也是卡片上的一行证据。 */
export type Claim = ExperienceCondition & {
	mode: "must" | "boost";
	what: NonNullable<ExperienceCondition["what"]>;
};

/**
 * 只定去留的条件：人的条件，和没说做过什么的经历主张——背景（「来自大厂」
 * 「待过字节」「入职前 3 年以上」）。背景说的是这个人待过哪、待了多久，
 * 不是他做得多深，所以和职级、学历一样是门槛。
 */
export type Gate = PersonCondition | ExperienceCondition;

/**
 * 启用条件按执行角色拆分。名次只看做过什么：`claims` 产出事实、定档和深度、
 * 画成证据行；`gates` 在取数 SQL 里按人过滤；`prefer` 满足一条乘一份固定的加分；
 * `excludes` 只否决经历段。
 */
type Query = {
	claims: Claim[];
	gates: Gate[];
	prefer: Gate[];
	excludes: ExperienceCondition[];
};

export function queryOf(conditions: readonly Condition[]): Query {
	const q: Query = { claims: [], gates: [], prefer: [], excludes: [] };
	for (const c of activeConditions(conditions)) {
		if (c.about === "experience" && c.mode === "exclude") q.excludes.push(c);
		else if (c.about === "experience" && c.what) q.claims.push(c as Claim);
		else if (c.mode === "must") q.gates.push(c);
		else q.prefer.push(c);
	}
	return q;
}

export function claimsOf(conditions: readonly Condition[]): Claim[] {
	return queryOf(conditions).claims;
}

export type Hit = {
	experienceId: number;
	claim: number;
	/** 命中的经历词。 */
	value: string;
	route: Route;
	relevance: number;
	phrase: string | null;
	involvement: string | null;
	startDate: string;
	endDate: string | null;
	org: string;
	title: string;
	seq: string;
};

export type ResultEmployee = Pick<
	Employee,
	"empId" | "name" | "curDept" | "curTitle" | "curLevel"
>;

/** 单人详情的显示契约；不包含内容键、派生版本或筛选档高。 */
export type EmployeeDetail = {
	employee: Pick<
		Employee,
		| "empId"
		| "name"
		| "curDept"
		| "curTitle"
		| "curSeqL1"
		| "curSeqL2"
		| "curSeqL3"
		| "curLevel"
		| "hireDate"
		| "educationLevel"
		| "school"
		| "recruitment"
	>;
	timeline: Pick<
		Experience,
		| "id"
		| "kind"
		| "startDate"
		| "endDate"
		| "org"
		| "orgPath"
		| "orgMeta"
		| "title"
		| "seqL1"
		| "seqL2"
		| "seqL3"
		| "seqInferredL1"
		| "seqInferredL2"
		| "level"
		| "description"
		| "months"
	>[];
};

type PopulationResult = {
	employee: ResultEmployee;
};

export type RankedResult = PopulationResult & {
	strength: Strength;
	depth: number;
	basis: (ClaimBasis | null)[];
	hits: Hit[];
};

export type SearchResult = PopulationResult | RankedResult;

export type ClaimBasis = {
	route: Route;
	value: string;
	relevance: number;
	months: number;
	endDate: string | null;
	/** 累计时长是否全部来自入职前经历。 */
	external: boolean;
};

/** 当前查询下的筛选候选，以及选中该项后的剩余人数。 */
export type Facets = { [K in DimKey]: Facet<K>[] };

type Outcome = {
	facets: Facets;
	total: number;
	empty: EmptyReason | null;
};

/** evidence 按证据可信度与深度排序；employee 用于没有经历证据的人员查询。 */
export type SearchOutcome =
	| (Outcome & {
			order: "evidence";
			claims: Claim[];
			results: RankedResult[];
	  })
	| (Outcome & {
			order: "employee";
			claims: [];
			results: PopulationResult[];
	  });

export function emptyFacets(): Facets {
	const facets = {} as Facets;
	for (const key of DIM_KEYS) facets[key] = [];
	return facets;
}

/** 关键词输入框的候选，经历词不显示人数。 */
export type Suggestion = { value: string; people: number | null };
