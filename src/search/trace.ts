/**
 * 查询理解这一轮查过什么。模型提交搜索条件之前，可以看数据目录里的取值、查经历词、试跑
 * 一份条件（`server/agent-tools.ts`），每查一次记一步，存在查询记录的 `trace` 上，右栏的
 * 线程边跑边画（`thread.tsx`）。较早的记录里还有查属性（`lookup_attribute`）那一种，
 * 记录不改，照样画。
 *
 * 这里只有类型和属性的名单，没有逻辑：查询记录表（`db/schema.ts`）、搜索（`search.ts`）
 * 和页面都用它，所以不能引用服务端代码。一步记的就是工具返回给模型的内容：模型据此写
 * 条件，HR 据此看出条件里的词和名字是怎么来的。提交通过不记步，它的结果就是这一轮的
 * 条件；没通过的记一步，只记哪一条、哪一类问题，回给模型的那句话不记（里面是写给模型的词）。
 * 步骤也是这一次理解还在进行的心跳（`server/turn.ts`）。
 */
import { VOCAB_KEYS, type VocabKey } from "./dimensions";

/** 人才库里的一种写法（标准能力词、公司名、学校名、词表取值）和写过它的人数。 */
export type Matched = { name: string; people: number };

/** 命中的一个标准能力词，连同它在词表里的上一级和下一级。 */
type TermMatch = Matched & {
	/** 更宽的那个词；没有，或写的人太少时为 null。 */
	broader: string | null;
	/** 更细的那几个词，人多的在前；写的人太少的不给。 */
	narrower: string[];
};

/** 一个经历词能找到多少人，以及它对应人才库里哪些标准能力词。 */
export type TermFinding = {
	text: string;
	/** 命中的人数：按人，不按段。 */
	people: number;
	/** 命中的标准能力词，相关度高的在前；写的人太少的不给。 */
	terms: TermMatch[];
};

/** 按名字包含匹配的三种属性：入职前公司、公司内部门、学校。 */
const NAME_FIELDS = ["company", "department", "school"] as const;
export type NameField = (typeof NAME_FIELDS)[number];

/** 模型能查的属性：有限取值的词表维和按名字匹配的属性。 */
export const ATTRIBUTE_FIELDS = [...VOCAB_KEYS, ...NAME_FIELDS] as const;
export type AttributeField = (typeof ATTRIBUTE_FIELDS)[number];

/** 一个名字能匹配到多少人，以及匹配到人才库里哪些写法。 */
export type NameFinding = {
	query: string;
	/** 匹配到的人数：公司按入职前经历，部门按公司内任职，学校按人员档案。 */
	people: number;
	/** 匹配到的写法，人多的在前；写的人太少的不给。部门名是内部信息，永远为空。 */
	values: Matched[];
};

/** 一条记录流的覆盖：多少人、几期、最早和最近一期。 */
export type StreamFact = {
	stream: string;
	label: string;
	kind: "rating" | "status";
	period: string;
	people: number;
	periods: number;
	first: string | null;
	latest: { start: string; end: string | null } | null;
	/** 评级流的档，从低到高；状态流为空 */
	scale: string[];
};

/** 看数据目录得到的：总览、一列的取值、按名字匹配到的写法，或者这一问为什么答不了。 */
export type Discovery =
	| {
			kind: "overview";
			relations: { name: string; label: string; rows: number }[];
			streams: StreamFact[];
	  }
	| { kind: "values"; subject: string; values: Matched[] }
	| { kind: "names"; subject: string; found: NameFinding[] }
	| { kind: "problem"; problem: string };

/** 试跑一份条件得到的：每条单独有多少人，整份多少人。 */
export type Probe = {
	conditions: {
		label: string;
		mode: "must" | "boost" | "exclude";
		people: number | null;
		problem: string | null;
	}[];
	total: number | null;
};

/**
 * 提交没通过检查的一处：哪一条条件（标签）或哪个词，哪一类问题。说整份的（没写完整）
 * 没有 `subject`；`wording` 也没有：那条标签里有的正是不该上屏的词，记下来线程里就照样
 * 显示出来了。
 *
 * - `form`：没写完整，有的条件或选项用不上。
 * - `wording`：有一条的标签里有 HR 读不懂的词。
 * - `unrunnable`：这样写搜不了。
 * - `unfound`：人才库里一个人都找不到。
 * - `tooBroad`：找出的太多，名单出不来。
 */
export type SubmitIssue = {
	kind: "form" | "wording" | "unrunnable" | "unfound" | "tooBroad";
	subject: string | null;
};

/** 这一步是什么时候记下的（epoch 毫秒）。 */
type Stamped = { at: number };

export type TraceStep = Stamped &
	(
		| { tool: "lookup_experience"; terms: TermFinding[] }
		| {
				tool: "lookup_attribute";
				field: VocabKey;
				/** 这一维的全部取值和人数，职级和学历按档从低到高。 */
				values: Matched[];
		  }
		| { tool: "lookup_attribute"; field: NameField; found: NameFinding[] }
		| { tool: "discover"; discovery: Discovery }
		| { tool: "probe"; probe: Probe }
		| { tool: "submit"; issues: SubmitIssue[] }
	);
