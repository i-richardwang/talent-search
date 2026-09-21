import type { Employee, Route } from "#/db/schema";
import {
	activeConditions,
	type Condition,
	type ExperienceCondition,
	type PersonCondition,
} from "./condition";
import { DIM_KEYS, type DimKey, type Facet } from "./dimensions";
import type { EmptyReason } from "./empty";
import type { Strength } from "./weights";

export type Claim = ExperienceCondition & { mode: "must" | "boost" };

/** 启用条件按执行角色拆分；排除条件只否决经历段，不产生证据行。 */
export type Query = {
	claims: Claim[];
	excludes: ExperienceCondition[];
	must: PersonCondition[];
	prefer: PersonCondition[];
};

export function queryOf(conditions: readonly Condition[]): Query {
	const q: Query = { claims: [], excludes: [], must: [], prefer: [] };
	for (const c of activeConditions(conditions)) {
		if (c.about === "experience") {
			if (c.mode === "exclude") q.excludes.push(c);
			else q.claims.push(c as Claim);
		} else if (c.mode === "must") q.must.push(c);
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
	/** 命中的经历词；不比文本的主张为 null。 */
	value: string | null;
	route: Route | null;
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
	route: Route | null;
	value: string | null;
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
