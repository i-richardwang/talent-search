/**
 * 查询理解这一轮查过的东西。模型在交表之前可以查词、查名称（`server/agent-tools.ts`），
 * 每查一次记一步，落在记录的 `trace` 上，右栏的线程边跑边画（`thread.tsx`）。
 *
 * 这里只有形状，没有逻辑：记录表（`db/schema.ts`）、检索（`search.ts`）和页面都读它，
 * 所以不能带服务端的东西。一步记的就是工具交给模型的那一份：模型据此写条件，
 * HR 据此看出条件里的词和名字是怎么来的。交表不记步：它的结果就是这一轮的条件。
 */

/** 人才库里的一种写法（标准能力词、公司名、学校名）和写过它的人数。 */
export type Written = { name: string; people: number };

/** 一个经历词按检索口径能找到多少人，以及它命中了库里哪些标准能力词。 */
export type TermFinding = {
	text: string;
	/** 命中的人数：按人，不按段。 */
	people: number;
	/** 命中的人多到几乎不筛人。 */
	wide: boolean;
	/** 命中的标准能力词，相关度高的在前；写的人太少的不给。 */
	terms: Written[];
};

/** 公司名、学校名这两种按名字匹配的条件。 */
export type NameField = "org" | "school";

/** 一个名字按检索口径能找到多少人，以及它匹配到库里的哪些公司或学校。 */
export type NameFinding = {
	name: string;
	/** 匹配到的人数。公司名连公司内的部门路径一起算，和条件的匹配口径一样。 */
	people: number;
	/** 匹配到的入职前公司或学校，人多的在前；写的人太少的不给。 */
	names: Written[];
};

/** 这一步是什么时候记下的（epoch 毫秒）。 */
type Stamped = { at: number };

export type TraceStep = Stamped &
	(
		| { tool: "find_terms"; terms: TermFinding[] }
		| { tool: "find_names"; field: NameField; names: NameFinding[] }
	);
