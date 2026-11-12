import type { Employee, Experience, Route } from "#/db/schema";
import type { Engagement } from "#/lib/engagement";
import { DIM_KEYS, type DimKey, type Facet } from "./dimensions";
import type { EmptyReason, Incomplete } from "./empty";
import type { Claim } from "./query";

/** 名单上一个人在一条主张上的一段证据：确认过算数的那一段，和它算数的那一类说法。 */
export type Evidence = {
	experienceId: number;
	kind: Experience["kind"];
	claim: number;
	route: Route;
	phrase: string | null;
	engagement: Engagement | null;
	startDate: string;
	endDate: string | null;
	company: string;
	department: string;
	title: string;
	seq: string;
};

/** 一段经历在哪：入职前是公司，公司内是部门，两者只有其一。 */
export function placeOf(segment: { company: string; department: string }) {
	return segment.company || segment.department;
}

export type ResultEmployee = Pick<
	Employee,
	"empId" | "name" | "curDept" | "curTitle" | "curLevel"
>;

/** 单人详情的显示契约；不包含内容键、解析版本或筛选档高。 */
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
		| "schoolTier"
		| "overseasEducated"
		| "recruitment"
	>;
	timeline: (Pick<
		Experience,
		| "id"
		| "kind"
		| "startDate"
		| "endDate"
		| "company"
		| "department"
		| "departmentPath"
		| "companyMeta"
		| "title"
		| "seqL1"
		| "seqL2"
		| "seqL3"
		| "seqInferredL1"
		| "seqInferredL2"
		| "level"
		| "description"
		| "months"
	> & {
		/** 入职前那家公司的主营行业，只写最细的一级；没认出公司或没有行业时为空 */
		mainIndustries: string[];
	})[];
};

type PopulationResult = {
	employee: ResultEmployee;
};

export type RankedResult = PopulationResult & {
	depth: number;
	basis: (ClaimBasis | null)[];
	evidence: Evidence[];
};

export type SearchResult = PopulationResult | RankedResult;

export type ClaimBasis = {
	/** 算数的经历段数，同一段只计一次。 */
	segments: number;
	months: number;
	endDate: string | null;
};

/** 当前查询下的筛选候选，以及选中该项后的剩余人数。 */
export type Facets = { [K in DimKey]: Facet<K>[] };

type Outcome = {
	facets: Facets;
	total: number;
	/** 名单还不完整时带这一项（见 `Incomplete`）；候选人都确认过时没有。 */
	incomplete?: Incomplete;
	empty: EmptyReason | null;
};

/** evidence 按深度排序；employee 用于没有经历证据的人员查询。 */
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
