/**
 * 界面测试要的两种行：一条命中事实（`Hit`）、一段经历（`Experience`）。
 *
 * 它们给的是**形状**，不是夹具数据——两个类型各有十来个字段，而每个测试只关心
 * 其中一两个，其余只是「必须有」。各文件各写一份默认值的话，两份会慢慢长得不
 * 一样，于是同一句断言在两个文件里跑的其实不是同一段输入，而那件事没有任何
 * 检查会红（`tsc` 只管字段齐不齐，不管值一不一致）。
 *
 * 库里真实的一份夹具在 `tests/fixture.ts`：那一份要进数据库、要跑真 SQL，
 * 这一份不出内存。
 *
 * 姓名、工号、公司名全是编的，和人才库无关。
 */
import type { Experience } from "#/db/schema";
import type { Hit } from "#/search/result";

export const hit = (over: Partial<Hit> = {}): Hit => ({
	experienceId: 1,
	term: "算法",
	route: "seq",
	relevance: 1,
	startDate: "2020-01-01",
	endDate: null,
	org: "云梯物流",
	title: "算法工程师",
	seq: "技术 · 算法",
	...over,
});

export const experience = (over: Partial<Experience> = {}): Experience => ({
	id: 1,
	empId: "T0001",
	kind: "internal",
	startDate: "2020-01-01",
	endDate: null,
	org: "云梯物流",
	orgPath: "某事业部/云梯物流",
	orgMeta: null,
	title: "某岗位",
	seqL1: "技术",
	seqL2: "算法",
	seqL3: "",
	level: "M3",
	description: "",
	months: 24,
	...over,
});
