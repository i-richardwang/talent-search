/**
 * 检索事实的纯求值：AND 判定、深度、排序、分面及证据选择。
 * 排名和分面读取同一份事实；时间由调用方传入，候选载荷上限由取数层执行。
 */

import type { Engagement } from "#/lib/engagement";
import {
	DIM_KEYS,
	type DimKey,
	type DimSource,
	type DimUnit,
	dimCompare,
	dimId,
	dimMatches,
	dimRank,
	dimValues,
	type Facet,
} from "./dimensions";
import type { SearchFilters } from "./params";
import type { Claim } from "./query";
import { type ClaimBasis, emptyFacets, type Facets } from "./result";
import {
	BOOST_WEIGHT,
	ENGAGEMENT_FACTOR,
	RECENCY_HALF,
	type Route,
	TENURE_HALF,
} from "./weights";

/** 候选人的分面属性；没有工作经历时经历单值为空，集合为空数组。 */
export type PopulationFact = DimSource & { empId: string };

/** 一段真实工作经历在一条主张上算数，包含排序属性与证据身份，不包含人员评分。 */
export type Fact = PopulationFact & {
	months: number;
	kind: "internal" | "external";
	id: number;
	/** 属于第几条主张 */
	claim: number;
	/** 算数的那一类说法，证据行上照实写出来源。 */
	route: Route;
	/**
	 * 算数的那条说法的文本，只有抽取的那类带（其余类的文本就是经历行上的
	 * 字段，回表取得到；简历原文太长，不放进事实行）。不参与计算，只为在
	 * 证据行上说出「算数的是哪个能力词」。
	 */
	phrase: string | null;
	/** 能力那一类的投入档（「主导」），参与深度并在证据行显示，其余类为 null。 */
	engagement: Engagement | null;
	/** null 表示至今 */
	endDate: string | null;
};

/**
 * 两条证据谁更对得上：比投入。来源不参与比较——任职记录和简历里写的都在说这个人做过什么，
 * 来源写在证据行上，信不信由 HR 判断。投入档只有抽取的技能上有：「负责搭建数据仓库」比
 * 「熟悉数据仓库」更像要找的人。
 */
function closer(a: Fact, b: Fact) {
	return weighted(a) - weighted(b);
}

function weighted(f: Fact) {
	return f.route === "skill" ? ENGAGEMENT_FACTOR[f.engagement ?? "做过"] : 1;
}

/**
 * 饱和函数 `x / (x + half)`：恒在 [0, 1) 内、处处单调、没有断崖，所以拿它当因子
 * 永远不会把一批人的分数压成同一个值（见 weights.ts 的 TENURE_HALF）。
 */
function saturate(x: number, half: number) {
	return x / (x + half);
}

/** 衰减函数 `half / (half + x)`：saturate 的镜像，x 越大越低，恒大于零。 */
function decay(x: number, half: number) {
	return half / (half + x);
}

/** 距今多少个月。仍在做（endDate 为 null）算 0。 */
export function gapMonths(endDate: string | null, now: Date) {
	if (!endDate) return 0;
	const match = /^(\d{4})-(\d{2})/.exec(endDate);
	if (!match) throw new Error(`无效结束日期：${endDate}`);
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const m = (now.getFullYear() - year) * 12 + (now.getMonth() - month);
	return m > 0 ? m : 0;
}

/**
 * 一条主张对一个人的**深度 = 投入 × 时长 × 近因**，三个都是 (0, 1] 内的因子。
 * 投入取最对得上的那条证据的（见 closer）；**时长是算数的那几段的累计**，近因取其中最近的一段。
 * 它们回答的是「投入多深、做了多久、离现在多近」；对不对得上在成为事实之前已经定了。
 * 主张上的 `minMonths` 判的就是这个累计值：筛和排看的是同一个数，证据行上写的也是它。
 */
function claimValue(claim: Claim, facts: Fact[] | undefined, now: Date) {
	if (!facts || !enough(claim, facts)) return null;
	const best = facts.reduce((a, b) => (closer(b, a) > 0 ? b : a));
	const months = monthsOf(facts);
	let gap = Number.POSITIVE_INFINITY;
	let endDate: string | null | undefined;
	// 只有全部段都来自入职前，这个累计值才配叫「前」（见 result.ts 的 external）
	let external = true;
	for (const f of facts) {
		if (f.kind !== "external") external = false;
		gap = Math.min(gap, gapMonths(f.endDate, now));
		if (f.endDate === null) endDate = null;
		else if (endDate !== null && (!endDate || f.endDate > endDate))
			endDate = f.endDate;
	}
	return {
		depth:
			weighted(best) * saturate(months, TENURE_HALF) * decay(gap, RECENCY_HALF),
		basis: {
			months,
			endDate: endDate ?? null,
			external,
		} satisfies ClaimBasis,
	};
}

/**
 * 累计证据段的月数；同一段 id 只计一次。
 */
function monthsOf(facts: readonly Fact[]) {
	const seen = new Set<number>();
	let months = 0;
	for (const f of facts)
		if (!seen.has(f.id)) {
			seen.add(f.id);
			months += f.months;
		}
	return months;
}

/** 这几段够不够这条主张：有证据段，而且累计时长够。 */
function enough(claim: Claim, facts: readonly Fact[]) {
	if (facts.length === 0) return false;
	return !claim.minMonths || monthsOf(facts) >= claim.minMonths;
}

/** 一个人在一次检索里的全部事实：主张下标 → 算数的段 */
type Person = Map<number, Fact[]>;

function addFact(p: Person, f: Fact) {
	const list = p.get(f.claim);
	if (list) list.push(f);
	else p.set(f.claim, [f]);
}

/** 把一个人的事实按主张归拢。AND 判定问的是「每条主张都有段吗」。 */
function byClaim(facts: readonly Fact[]): Person {
	const p: Person = new Map();
	for (const f of facts) addFact(p, f);
	return p;
}

/** 按人、按主张归拢通过 `keep` 的事实；后续计算只读取这份稳定集合。 */
function bucket(facts: Fact[], keep: (f: Fact) => boolean) {
	const byEmp = new Map<string, Person>();
	for (const f of facts) {
		if (!keep(f)) continue;
		let p = byEmp.get(f.empId);
		if (!p) {
			p = new Map();
			byEmp.set(f.empId, p);
		}
		addFact(p, f);
	}
	return byEmp;
}

/**
 * 这个人算不算数：**每条必须的主张**都得满足（AND 语义）。
 *
 * 加分的主张不参与判定：只进分数，不进判定。
 */
function complete(p: Person, claims: Claim[]) {
	for (const [i, claim] of claims.entries()) {
		if (claim.mode !== "must") continue;
		if (!enough(claim, p.get(i) ?? [])) return false;
	}
	return true;
}

/**
 * 一个人的名次依据：**深度 = 必须主张的乘积 × 加分主张的抬升 × 人的偏好的抬升。** 必须主张之间是
 * 乘积：一条浅，整个人就被压下去。淘汰由 `complete` 负责，不是由乘积负责——
 * 加分那一半恒大于 1，只抬不压，所以不会出现「命中得越少分越高」。满足的每
 * 一条偏好（人的条件和背景，见 `query.ts` 的 `Gate`）各乘一次 `BOOST_WEIGHT`：
 * 「最好字节来的」和「最好是硕士」满足一条就该得一条的分，不看在字节待了多久。
 */
function measure(
	p: Person,
	claims: Claim[],
	preferred: readonly ReadonlySet<string>[],
	empId: string,
	now: Date,
) {
	let depth = 1;
	const basis: (ClaimBasis | null)[] = [];
	for (const [i, claim] of claims.entries()) {
		const value = claimValue(claim, p.get(i), now);
		if (claim.mode === "must") {
			// `complete` 已经保证必须的主张都有证据；没有就是调用方漏了判定
			if (!value) throw new Error(`必须的主张 ${i} 没有证据却进了打分`);
			basis.push(value.basis);
			depth *= value.depth;
		} else if (value) {
			// 没满足的加分主张不加分，依据也不留：留了它就会画成一行证据，
			// 而名次里没有它——「看得见的东西能解释看到的名次」就不成立了
			basis.push(value.basis);
			depth *= 1 + BOOST_WEIGHT * value.depth;
		} else basis.push(null);
	}
	for (const set of preferred) if (set.has(empId)) depth *= 1 + BOOST_WEIGHT;
	return { depth, basis };
}

/**
 * 按维度声明求值筛选。计算分面时，except 去掉该维自身的筛选。
 */
function keeps(f: SearchFilters, except?: DimKey) {
	return (x: PopulationFact) =>
		DIM_KEYS.every((key) => key === except || dimMatches(key, f[key], x));
}

/**
 * 分面的值域只随查询变化；计数带其余筛选，去掉正在计算的这一维。
 * 没有计数的选项保留为零，只有查询下从未成立的取值不进入值域。
 * qualifies 判定这个人在该取值下是否满足全部必须主张；人员查询没有经历主张。
 */
function facetRows<K extends DimKey, F extends PopulationFact>(
	facts: readonly F[],
	key: K,
	filters: SearchFilters,
	qualifies: (person: readonly F[]) => boolean,
): Facet<K>[] {
	const domain = tally(facts, key, () => true, qualifies);
	const live = tally(facts, key, keeps(filters, key), qualifies);
	return [...domain].map(([id, { value, rank }]) => ({
		value,
		n: live.get(id)?.n ?? 0,
		...(rank !== undefined && { rank }),
	}));
}

/**
 * 一维上「哪个取值下有几个人」。`keep` 决定哪些事实参与，`qualifies` 决定一个人
 * 在这个取值下算不算数。数不出人的取值不进结果——值域与计数的差别由调用方
 * 用两套参数跑两遍表达，不在这里分叉。
 */
function tally<K extends DimKey, F extends PopulationFact>(
	facts: readonly F[],
	key: K,
	keep: (f: F) => boolean,
	qualifies: (person: readonly F[]) => boolean,
) {
	const byValue = new Map<
		string,
		{ value: DimUnit[K]; rank?: number; people: Map<string, F[]> }
	>();
	for (const f of facts) {
		if (!keep(f)) continue;
		for (const value of dimValues(key, f)) {
			const id = dimId(key, value);
			let bucket = byValue.get(id);
			if (!bucket) {
				bucket = { value, rank: dimRank(key, f), people: new Map() };
				byValue.set(id, bucket);
			}
			const list = bucket.people.get(f.empId);
			if (list) list.push(f);
			else bucket.people.set(f.empId, [f]);
		}
	}
	const out = new Map<
		string,
		{ value: DimUnit[K]; rank?: number; n: number }
	>();
	for (const [id, bucket] of byValue) {
		let n = 0;
		for (const person of bucket.people.values()) if (qualifies(person)) n++;
		if (n > 0) out.set(id, { value: bucket.value, rank: bucket.rank, n });
	}
	return out;
}

/**
 * 各维度分别计算查询值域与当前筛选下的人数。
 */
function computeFacets(
	facts: Fact[],
	claims: Claim[],
	filters: SearchFilters,
): Facets {
	const out = emptyFacets();
	for (const key of DIM_KEYS)
		fill(
			out,
			key,
			facetRows(facts, key, filters, (person) =>
				complete(byClaim(person), claims),
			),
		);
	return out;
}

/**
 * 把一维的候选放进结果，顺带按这一维自己的规则排好。
 *
 * 每一维的取值类型各不相同，而循环里的 `key` 是联合——TS 推断不出这份对应关系，
 * 只能在这一处断言。断言之外没有别的地方需要知道「哪一维是什么形状」。
 */
function fill(out: Facets, key: DimKey, rows: Facet[]) {
	Object.assign(out, {
		[key]: rows.sort((a, b) => dimCompare(key, a, b)),
	});
}

function populationFacets(
	facts: PopulationFact[],
	filters: SearchFilters,
): Facets {
	const out = emptyFacets();
	for (const key of DIM_KEYS)
		fill(
			out,
			key,
			facetRows(facts, key, filters, () => true),
		);
	return out;
}

type Ranked = {
	empId: string;
	depth: number;
	basis: (ClaimBasis | null)[];
};

/**
 * 名次：深度高的在前，同分按工号。
 *
 * 同分按工号保持确定的顺序，增加 limit 翻页时已有名单逐位不变。
 */
function byDepth(a: Ranked, b: Ranked) {
	return b.depth - a.depth || a.empId.localeCompare(b.empId);
}

/** 这份事实下谁在名单上、按什么顺序。now 是本次检索的共同时间依据。 */
export function order(
	facts: Fact[],
	population: PopulationFact[],
	claims: Claim[],
	filters: SearchFilters,
	now: Date,
	/** 每条人的偏好各一份满足它的人（`execute.ts` 的 `fetchPreferred`）。 */
	preferred: readonly ReadonlySet<string>[] = [],
): Ranked[] {
	const ranked: Ranked[] = [];
	const evidence = bucket(facts, keeps(filters));
	const candidates = new Set(
		population.filter(keeps(filters)).map((row) => row.empId),
	);
	for (const empId of candidates) {
		const p = evidence.get(empId) ?? new Map<number, Fact[]>();
		if (!complete(p, claims)) continue;
		ranked.push({ empId, ...measure(p, claims, preferred, empId, now) });
	}
	return ranked.sort(byDepth);
}

/** 对同一份事实计算名次与分面。 */
export function rank(
	facts: Fact[],
	population: PopulationFact[],
	claims: Claim[],
	filters: SearchFilters,
	now: Date,
	preferred: readonly ReadonlySet<string>[] = [],
): {
	ranked: Ranked[];
	facets: Facets;
	total: number;
} {
	const ranked = order(facts, population, claims, filters, now, preferred);
	return {
		ranked,
		facets: claims.some((claim) => claim.mode === "must")
			? computeFacets(facts, claims, filters)
			: populationFacets(population, filters),
		total: ranked.length,
	};
}

/** 「这个人的这条主张」的复合 key：工号里不可能出现的字符。 */
const PER_CLAIM = "\u0001";

/**
 * 这一页的人各自留哪几段经历当证据。
 *
 * 只对已经定好名次的那一页算，所以它不进排序的开销。排序键：最对得上的在前
 * （`closer`），再取长的，再按 id——展示顺序必须是确定的，否则
 * 同一次查询刷新两次证据会换位置。这里刻意不用主张的深度：那是**人**的属性
 * （累计、近因都跨段），而这里要选的是单独一段，两者不是同一个量。
 *
 * 没满足的主张一段都不留（`enough`，和打分同一条判定）。
 */
export function pageEvidence(
	facts: Fact[],
	claims: readonly Claim[],
	filters: SearchFilters,
	empIds: Set<string>,
	perClaim: number,
): Map<string, Fact[]> {
	const keep = keeps(filters);
	const byKey = new Map<string, { empId: string; facts: Fact[] }>();
	for (const f of facts) {
		if (!empIds.has(f.empId) || !keep(f)) continue;
		const k = f.empId + PER_CLAIM + f.claim;
		const bucket = byKey.get(k);
		if (bucket) bucket.facts.push(f);
		else byKey.set(k, { empId: f.empId, facts: [f] });
	}
	const out = new Map<string, Fact[]>();
	for (const { empId, facts: list } of byKey.values()) {
		const claim = claims[list[0]?.claim ?? -1];
		if (!claim || !enough(claim, list)) continue;
		list.sort((a, b) => closer(b, a) || b.months - a.months || a.id - b.id);
		const acc = out.get(empId) ?? [];
		acc.push(...list.slice(0, perClaim));
		out.set(empId, acc);
	}
	// 主张的顺序即行序：结果里每个人的每条证据对应一条主张，按下标排好再返回
	for (const list of out.values())
		list.sort(
			(a, b) => a.claim - b.claim || closer(b, a) || b.months - a.months,
		);
	return out;
}
