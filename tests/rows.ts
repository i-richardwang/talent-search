/** 界面规则测试的内存行工厂。与数据库夹具分开；姓名、工号和经历均为合成。 */
import type { Experience } from "#/db/schema";
import type { Hit } from "#/search/result";

export const hit = (over: Partial<Hit> = {}): Hit => ({
	experienceId: 1,
	claim: 0,
	value: "算法",
	route: "seq",
	relevance: 1,
	phrase: null,
	involvement: null,
	startDate: "2020-01-01",
	endDate: null,
	org: "云梯物流",
	title: "算法工程师",
	seq: "技术 · 算法",
	...over,
});

export const experience = (over: Partial<Experience> = {}): Experience => ({
	id: 1,
	contentKey: "",
	empId: "T0001",
	kind: "internal",
	unemployed: false,
	startDate: "2020-01-01",
	endDate: null,
	org: "云梯物流",
	orgPath: "某事业部/云梯物流",
	orgMeta: null,
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
	...over,
});
