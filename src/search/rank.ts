/**
 * 打分、AND 判定、排序、分面——一次检索里除了「取数」之外的全部逻辑。
 *
 * 这个文件**没有 SQL，也没有数据库**。检索层只负责回答「哪些经历段命中了哪个
 * 概念词」这个纯事实问题，剩下的全部在这里对内存里的事实求值。
 *
 * 打分是纯函数，调权重不必连接数据库；排名与分面对同一份事实做不同分组，
 * 两者的口径由结构保证一致。
 *
 * 代价是候选事实要全部拉回内存，`FACT_MAX` 是保险丝而不是产品限制。
 *
 * 它的入参是 `Fact[]`，不关心那些命中是怎么找出来的：换检索手段时改的是
 * 「事实从哪来」，这个文件不动。
 */
import {
	emptyFacets,
	type Facets,
	type SearchFilters,
	type TermBasis,
	type TermPlan,
} from "./result";
import {
	BOOST_WEIGHT,
	FORM_WEIGHTS,
	type FormTier,
	isControlledRoute,
	MIN_MONTHS_BUCKETS,
	RECENCY_FLOOR,
	RECENCY_HALF,
	ROUTE_WEIGHTS,
	type Route,
	TENURE_FLOOR,
	TENURE_HALF,
} from "./weights";

/**
 * 一段经历对一条要求的命中。这是检索层唯一的产物：**事实，不含任何评分**。
 *
 * 字段只有两类：打分要用的（route / tier / months / endDate）和分面要分组的
 * （seq / companyTag / kind / months）。`id` 只用来在定好名次之后回表取展示用的
 * 原文；`memberIdx` 只用来在出结果时说出「命中的是哪个说法」——都不参与计算。
 */
export type Fact = {
	id: number;
	empId: string;
	termIdx: number;
	/** 命中的是这条要求的第几个说法（TermPlan.members 的下标） */
	memberIdx: number;
	/** 那个说法的档位。权重直接从它查，不用回 TermPlan 找。 */
	tier: FormTier;
	route: Route;
	months: number;
	/** null 表示至今 */
	endDate: string | null;
	seqL1: string;
	seqL2: string;
	companyTag: string | null;
	kind: "internal" | "external";
};

/**
 * 一条证据的强度 = 字眼档位 × 路权重。两个都是「这条证据有多能说明他真的
 * 做过用户要的那件事」的因子：前者管词离用户的意思多远，后者管字段是谁写的。
 */
function evidenceWeight(f: Fact) {
	return FORM_WEIGHTS[f.tier] * ROUTE_WEIGHTS[f.route];
}

/**
 * 饱和函数：`x / (x + half)` 抬到地板之上。恒在 [floor, 1) 内、处处单调、
 * 没有断崖，所以拿它当因子永远不会把一段人口压平（见 weights.ts 的 TENURE_HALF）。
 */
function saturate(x: number, half: number, floor: number) {
	return floor + (1 - floor) * (x / (x + half));
}

/** 衰减函数：`half / (half + x)` 抬到地板之上。saturate 的镜像，x 越大越低。 */
function decay(x: number, half: number, floor: number) {
	return floor + (1 - floor) * (half / (half + x));
}

/** 距今多少个月。仍在做（endDate 为 null）算 0。 */
export function gapMonths(endDate: string | null, now: Date) {
	if (!endDate) return 0;
	const match = /^(\d{4})-(\d{2})/.exec(endDate);
	if (!match) return 0;
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const m = (now.getFullYear() - year) * 12 + (now.getMonth() - month);
	return m > 0 ? m : 0;
}

/**
 * 一条要求对一个人的分数 = **强度 × 时长 × 近因**，三个都是有界因子。
 *
 * **强度**取该人所有命中段里最硬的一条证据（字眼档位 × 路权重，见
 * evidenceWeight）。做过三段算法不比做过一段更「做过」，所以强度不累加，
 * 它回答的是「最硬的那条证据有多能说明他真的做过」。
 *
 * **时长与近因只看并列最硬的那些段。** 这两样是「那条证据」的属性：拿简历里
 * 提过一句的段去给序列命中续时长，是把两种强度的证据混成一份。规则简单的
 * 好处是分数永远解释得清——它回答的始终是「最硬的那条证据有多硬、有多久、
 * 有多近」。
 *
 * 两个因子的地板刻意抬得很高，好让它们**永远压不过证据强度**（论证见 weights.ts
 * 的 TENURE_FLOOR）：它们决定的是同一档证据内部的先后，不是证据的档次。
 */
function termValue(facts: Fact[], term: string, now: Date) {
	let strength = 0;
	for (const f of facts) strength = Math.max(strength, evidenceWeight(f));
	let months = 0;
	let gap = Number.POSITIVE_INFINITY;
	const routes = new Set<Route>();
	let endDate: string | null | undefined;
	// 只有全部段都来自入职前，这个累计值才配叫「前」（见 result.ts 的 external）
	let external = true;
	for (const f of facts) {
		if (evidenceWeight(f) < strength) continue;
		routes.add(f.route);
		months += f.months;
		if (f.kind !== "external") external = false;
		gap = Math.min(gap, gapMonths(f.endDate, now));
		if (f.endDate === null) endDate = null;
		else if (endDate !== null && (!endDate || f.endDate > endDate))
			endDate = f.endDate;
	}
	if (routes.size === 0) return { score: 0, basis: null };
	return {
		score:
			strength *
			saturate(months, TENURE_HALF, TENURE_FLOOR) *
			decay(gap, RECENCY_HALF, RECENCY_FLOOR),
		basis: {
			term,
			routes: [...routes].sort(),
			months,
			endDate: endDate ?? null,
			external,
		} satisfies TermBasis,
	};
}

/** 一个人在一次检索里的全部事实：概念词下标 → 命中的段 */
type Person = Map<number, Fact[]>;

/** 按人、按词把事实归拢。`keep` 在这一步生效，此后不再有「哪些事实算数」的问题。 */
function bucket(facts: Fact[], keep: (f: Fact) => boolean) {
	const byEmp = new Map<string, Person>();
	for (const f of facts) {
		if (!keep(f)) continue;
		let p = byEmp.get(f.empId);
		if (!p) {
			p = new Map();
			byEmp.set(f.empId, p);
		}
		const list = p.get(f.termIdx);
		if (list) list.push(f);
		else p.set(f.termIdx, [f]);
	}
	return byEmp;
}

/**
 * 这个人算不算数：**每个必须词**都得命中（AND 语义）；开了证据要求就还得
 * 每个必须词都有受控命中。
 *
 * 加分词不参与，这就是它「加分」的全部含义：只进分数，不进门槛。证据要求同样
 * 只管必须词——要求一个可有可无的词必须有受控证据，是自相矛盾的。
 */
function complete(p: Person, terms: TermPlan[], strong: boolean) {
	for (const [i, t] of terms.entries()) {
		if (t.mode !== "must") continue;
		const fs = p.get(i);
		if (!fs) return false;
		if (strong && !fs.some((f) => isControlledRoute(f.route))) return false;
	}
	return true;
}

/**
 * 总分 = 必须词的乘积 × 加分词的抬升。
 *
 * 必须词之间是乘积：一个词弱，整个人就被压下去。淘汰由 `complete` 负责，不是
 * 由乘积负责——加分那一半恒大于 1，只抬不压，所以不会出现「命中得越少分越高」。
 */
function score(p: Person, terms: TermPlan[], now: Date) {
	let s = 1;
	const basis: (TermBasis | null)[] = [];
	for (const [i, t] of terms.entries()) {
		const fs = p.get(i);
		const value = termValue(fs ?? [], t.term, now);
		basis.push(value.basis);
		if (t.mode === "must") s *= value.score;
		else if (fs) s *= 1 + BOOST_WEIGHT * value.score;
	}
	return { score: s, basis };
}

/** 五个筛选维度。`Facets` 的键与它逐字一致。 */
type Dim = "seq" | "companyTag" | "kind" | "minMonths" | "strong";

/**
 * 筛选谓词。`except` 是它存在的全部理由：算「序列」这一维的候选时必须把序列
 * 自己的筛选摘掉，不摘的话选中一项之后其余项的计数全是 0，用户点不动第二次。
 */
function keeps(f: SearchFilters, except?: Dim) {
	return (x: Fact) => {
		if (except !== "seq" && f.seqL1 && x.seqL1 !== f.seqL1) return false;
		if (except !== "seq" && f.seqL2 && x.seqL2 !== f.seqL2) return false;
		if (except !== "kind" && f.kind && x.kind !== f.kind) return false;
		if (except !== "minMonths" && f.minMonths && x.months < f.minMonths)
			return false;
		if (
			except !== "companyTag" &&
			f.companyTag &&
			x.companyTag !== f.companyTag
		)
			return false;
		return true;
	};
}

/** 合成 key 的分隔符：序列名里出现「/」并不稀奇，得用一个不可能出现在数据里的字符 */
const SEP = "\u0001";

/**
 * 某一维的「选了这一项之后还剩几个人」。
 *
 * 口径与主检索逐字相同：同一个 `complete`、同一份事实，区别只在把这一维自己的
 * 筛选摘掉、并且额外把事实限制在候选值上。`values` 返回数组是为了「最短时长」——
 * 一段 36 个月的经历同时算进 6/12/24/36 四个档。
 */
function facetCount(
	facts: Fact[],
	terms: TermPlan[],
	filters: SearchFilters,
	dim: Dim,
	values: (f: Fact) => string[],
) {
	const keep = keeps(filters, dim);
	const strong = dim !== "strong" && Boolean(filters.strong);
	const byValue = new Map<string, Map<string, Person>>();
	for (const f of facts) {
		if (!keep(f)) continue;
		for (const v of values(f)) {
			let people = byValue.get(v);
			if (!people) {
				people = new Map();
				byValue.set(v, people);
			}
			let p = people.get(f.empId);
			if (!p) {
				p = new Map();
				people.set(f.empId, p);
			}
			const list = p.get(f.termIdx);
			if (list) list.push(f);
			else p.set(f.termIdx, [f]);
		}
	}
	const out = new Map<string, number>();
	for (const [v, people] of byValue) {
		let n = 0;
		for (const p of people.values()) if (complete(p, terms, strong)) n++;
		if (n > 0) out.set(v, n);
	}
	return out;
}

/**
 * 五个维度的候选与人数。
 *
 * 计数的口径是「在当前这次检索里，选了这一项之后还剩多少人」；算不出人的选项
 * 根本不会出现——这是筛选项列表能变短的原因。
 */
function computeFacets(
	facts: Fact[],
	terms: TermPlan[],
	filters: SearchFilters,
): Facets {
	const out = emptyFacets();

	// 两级都要有值：只有一级的话选项值会编码成 "技术/"，而筛选用真值判断 seqL2，
	// 空串是 falsy，点下去这一维根本不生效。
	for (const [v, n] of facetCount(facts, terms, filters, "seq", (f) =>
		f.seqL1 && f.seqL2 ? [f.seqL1 + SEP + f.seqL2] : [],
	)) {
		const [seqL1 = "", seqL2 = ""] = v.split(SEP);
		out.seq.push({ seqL1, seqL2, n });
	}

	for (const [value, n] of facetCount(
		facts,
		terms,
		filters,
		"companyTag",
		(f) => (f.companyTag && f.companyTag !== "未知" ? [f.companyTag] : []),
	))
		out.companyTag.push({ value, n });

	for (const [value, n] of facetCount(facts, terms, filters, "kind", (f) => [
		f.kind,
	]))
		out.kind.push({ value: value as "internal" | "external", n });

	for (const [value, n] of facetCount(facts, terms, filters, "minMonths", (f) =>
		MIN_MONTHS_BUCKETS.filter((th) => f.months >= th).map(String),
	))
		out.minMonths.push({ value: Number(value), n });

	// 「证据要求」这一维的两头：打开还剩几个（on）、关掉能看到几个（off）。
	// 两个数都把证据要求自己摘掉之后再算。
	for (const p of bucket(facts, keeps(filters, "strong")).values()) {
		if (!complete(p, terms, false)) continue;
		out.strong.off++;
		if (complete(p, terms, true)) out.strong.on++;
	}

	// 人多的排前面；时长档位反过来按档位排，它是有序的量，不是并列的类别
	out.seq.sort((x, y) => y.n - x.n);
	out.companyTag.sort((x, y) => y.n - x.n);
	out.minMonths.sort((x, y) => x.value - y.value);
	return out;
}

type Ranked = {
	empId: string;
	score: number;
	basis: (TermBasis | null)[];
};

/**
 * 一次检索的名次与分面。两者出自同一份事实，所以口径不可能分家。
 *
 * `now` 是入参而不是函数体里的 `new Date()`：近因让分数依赖「今天」，而依赖
 * 当前时间的函数是测不动的。调用方传一次，测试传一个钉死的日期。
 */
export function rank(
	facts: Fact[],
	terms: TermPlan[],
	filters: SearchFilters,
	now: Date,
): { ranked: Ranked[]; facets: Facets; total: number } {
	const ranked: Ranked[] = [];
	for (const [empId, p] of bucket(facts, keeps(filters))) {
		if (!complete(p, terms, Boolean(filters.strong))) continue;
		ranked.push({ empId, ...score(p, terms, now) });
	}
	// 同分按工号，排序才是确定的：翻页靠把 limit 调大重查，前一页必须逐位不变
	ranked.sort((a, b) => b.score - a.score || (a.empId < b.empId ? -1 : 1));
	return {
		ranked,
		facets: computeFacets(facts, terms, filters),
		total: ranked.length,
	};
}

/**
 * 这一页的人各自留哪几段经历当证据。
 *
 * 只对已经定好名次的那一页算，所以它不进排序的开销。排序键：证据硬的在前，
 * 同档取长的，再同按 id——展示顺序必须是确定的，否则同一次查询刷新两次证据
 * 会换位置。这里刻意不用词分：词分是**人**的属性（累计、近因都跨段），
 * 而这里要选的是单独一段，两者不是同一个量。
 */
export function pageHits(
	facts: Fact[],
	filters: SearchFilters,
	empIds: Set<string>,
	perTerm: number,
): Map<string, Fact[]> {
	const keep = keeps(filters);
	const byKey = new Map<string, Fact[]>();
	for (const f of facts) {
		if (!empIds.has(f.empId) || !keep(f)) continue;
		const k = f.empId + SEP + f.termIdx;
		const list = byKey.get(k);
		if (list) list.push(f);
		else byKey.set(k, [f]);
	}
	const out = new Map<string, Fact[]>();
	for (const list of byKey.values()) {
		list.sort(
			(a, b) =>
				evidenceWeight(b) - evidenceWeight(a) ||
				b.months - a.months ||
				a.id - b.id,
		);
		const emp = list[0]?.empId;
		if (emp === undefined) continue;
		const acc = out.get(emp) ?? [];
		acc.push(...list.slice(0, perTerm));
		out.set(emp, acc);
	}
	// 词序即行序：结果里每个人的每条证据对应一条要求，按要求下标排好再交出去
	for (const list of out.values())
		list.sort(
			(a, b) =>
				a.termIdx - b.termIdx ||
				evidenceWeight(b) - evidenceWeight(a) ||
				b.months - a.months,
		);
	return out;
}
