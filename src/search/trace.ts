/**
 * 查询理解这一轮做过什么。模型提交搜索条件之前，可以看数据目录里的取值、按字面捞说法、试跑
 * 一份条件、读候选人的经历并挑出符合的（`server/agent-tools.ts`），每做一次记一步，存在查询
 * 记录的 `trace` 上，右栏的线程边跑边画（`thread.tsx`）。HR 直接改条件之后把新进范围的候选人
 * 确认完，记的是同样的步骤。
 *
 * 这里只有类型，没有逻辑：查询记录表（`db/schema.ts`）、搜索（`search.ts`）
 * 和页面都用它，所以不能引用服务端代码。工具回给模型的结果也在这里定形状（`Matched` 到
 * `Discovery`），由 `search.ts` 和 `server/discover.ts` 产出；一步只记线程画得出的那几样
 * （`TraceStep`），回给模型的人数、正则和原因不记。提交通过不记步，它的结果就是这一轮的
 * 条件；没通过的记一步，只记哪一条、哪一类问题，回给模型的那句话不记（里面是写给模型的词）。
 * 步骤也是这一次理解还在进行的心跳（`server/turn.ts`）。
 */
import type { Mode } from "./condition";

/** 人才库里的一种写法（说法、公司名、部门名、学校名、词表取值）和写过它的人数。 */
export type Matched = { name: string; people: number };

/** 一条正则按字面捞到了什么。 */
export type PatternFinding = {
	pattern: string;
	/** 捞到多少种说法 */
	phrases: number;
	/** 写了其中任一条的人数：按人，不按段 */
	people: number;
	/** 写的人最多的那些说法 */
	top: Matched[];
	/** 正则写不对时的原因 */
	problem: string | null;
};

/** 一个名字能匹配到多少人，以及匹配到人才库里哪些写法。 */
export type NameFinding = {
	query: string;
	/** 匹配到的人数：公司按入职前经历，部门按公司内任职，学校按人员档案。 */
	people: number;
	/** 匹配到的写法，人多的在前 */
	values: Matched[];
};

/** 一条记录流的覆盖：多少人、几期、最早和最近一期。 */
export type StreamFact = {
	stream: string;
	label: string;
	kind: "rating" | "status";
	period: string;
	people: number;
	/** 不同的开始日有几个：评级是几期，状态是几次进出 */
	periods: number;
	first: string | null;
	/** 最近一期（一段）的起止；状态仍有效时结束为空 */
	latest: { start: string; end: string | null } | null;
	/** 取值：评级流是档，从低到高；状态流是库里出现过的状态，人多的在前 */
	values: string[];
};

/** 行业树上的一个行业：待过主营是它的公司的人数，和待过做它（主营或涉足）的公司的人数。 */
type IndustryFact = {
	name: string;
	/** 上一级行业；顶层为 null */
	parent: string | null;
	main: number;
	any: number;
};

/**
 * 入职前那些公司的概况，提示词里预先给：行业树和人数、名企组合、企业性质，以及有多少段
 * 入职前的经历认出了公司、有行业——没认出的段不满足任何行业条件，模型要知道名单可能漏人。
 */
export type CompanyFacts = {
	industries: IndustryFact[];
	circles: Matched[];
	natures: Matched[];
	segments: number;
	recognized: number;
	labelled: number;
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

/**
 * 看目录这一步记下的：有哪些记录流、从什么时候起，一列有哪些取值，一个名字匹配到哪些写法
 * （没有写法就是人才库里没有），或者这一问答不了。人数是全库的，不放在名单旁边，不记。
 */
export type DiscoveryTrace =
	| { kind: "overview"; streams: { label: string; first: string | null }[] }
	| { kind: "values"; subject: string; values: string[] }
	| {
			kind: "names";
			subject: string;
			found: { query: string; values: string[] }[];
	  }
	| { kind: "problem" };

/** 捞说法这一步记下的一条正则：捞到多少种说法，和线程一行列得下的那几种。 */
export type FoundTrace = { phrases: number; top: string[] };

/**
 * 试跑一份条件得到的：每条单独选中多少人，名单上多少人，候选人多少、还有多少段经历没确认过。
 */
export type Probe = {
	conditions: {
		label: string;
		mode: Mode;
		/**
		 * 这条单独选中的人数；写了「做过什么」的是字面对得上的人，含还没确认过的。
		 * 这一条写不对、跑不了时为 null。
		 */
		people: number | null;
	}[];
	/** 名单上的人数 */
	total: number | null;
	/** 候选人数：还没确认过的经历都按对这个人有利的算，名单上会有多少人 */
	candidates: number | null;
	/** 候选人还没确认过的经历有几段：先数必须和排除的条件上的，它们确认完了才数加分的 */
	unread: number;
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
 * - `unread`：候选人还有经历没确认完：还没读完，或者读过之后改了那一条的判据、读过的结论
 *   用不上（这时 `subject` 是那一条）。
 */
export type SubmitIssue = {
	kind: "form" | "wording" | "unrunnable" | "unfound" | "tooBroad" | "unread";
	subject: string | null;
};

/** 这一步是什么时候记下的（epoch 毫秒）。 */
type Stamped = { at: number };

export type TraceStep = Stamped &
	(
		| { tool: "find"; found: FoundTrace[] }
		| { tool: "discover"; discovery: DiscoveryTrace }
		| { tool: "probe"; probe: Probe }
		/** 取了一批候选人的经历来读：这一批几段，连这一批还剩几段没确认 */
		| { tool: "read"; segments: number; left: number }
		/** 去取经历时这份条件出不了名单（有一条跑不了，或者找出的太多），没有经历可读 */
		| { tool: "read"; unlisted: true }
		/** 读完一批下的结论：符合的几段，不符合的几段 */
		| { tool: "judge"; fits: number; unfit: number }
		/** 交的结论没收（手上没有这一批，或者交的编号不在这一批里）：这一批要重新判断 */
		| { tool: "judge"; redo: true }
		| { tool: "submit"; issues: SubmitIssue[] }
	);
