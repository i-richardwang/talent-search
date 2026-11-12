/** 界面规则测试的内存行工厂。与数据库夹具分开；姓名、工号和经历均为合成。 */
import type { Experience } from "#/db/schema";
import type { Evidence } from "#/search/result";

export const evidence = (over: Partial<Evidence> = {}): Evidence => ({
	experienceId: 1,
	kind: "internal",
	claim: 0,
	route: "role",
	phrase: null,
	engagement: null,
	startDate: "2020-01-01",
	endDate: null,
	company: "",
	department: "云梯物流",
	title: "算法工程师",
	seq: "技术 · 算法",
	...over,
});

/** 详情里的一段：库里的一行，加上那家公司的主营行业。 */
export type Segment = Experience & { mainIndustries: string[] };

export const experience = (over: Partial<Segment> = {}): Segment => ({
	id: 1,
	contentKey: "",
	empId: "T0001",
	kind: "internal",
	unemployed: false,
	startDate: "2020-01-01",
	endDate: null,
	company: "",
	department: "云梯物流",
	departmentPath: "某事业部/云梯物流",
	companyMeta: null,
	title: "某岗位",
	seqL1: "技术",
	seqL2: "算法",
	seqL3: "",
	seqInferredL1: "",
	seqInferredL2: "",
	level: "M3",
	description: "",
	months: 24,
	derivedIdentity: null,
	unanswered: false,
	mainIndustries: [],
	...over,
});
