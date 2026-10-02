/**
 * 检索事实的纯求值：AND 判定、可信度与深度、排序、分面及证据选择。
 * 排名和分面读取同一份事实；时间由调用方传入，候选载荷上限由取数层执行。
 */

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
import { strengthOf } from "./evidence";
import type { SearchFilters } from "./params";
import {
	type Claim,
	type ClaimBasis,
	emptyFacets,
	type Facets,
} from "./result";
import {
	BOOST_WEIGHT,
	RECENCY_HALF,
	type Route,
	type Strength,
	strengthRank,
	TENURE_HALF,
} from "./weights";

/** 候选人的分面属性；没有工作经历时经历单值为空，集合为空数组。 */
export type PopulationFact = DimSource & { empId: string };

/** 一段真实工作经历对一条主张的命中，包含排序属性与证据身份，不包含人员评分。 */
export type Fact = PopulationFact & {
	months: number;
	kind: "internal" | "external";
	seqL1: string;
	seqL2: string;
	id: number;
	/** 属于第几条主张 */
	claim: number;
	/** 命中的是这条主张的哪个经历词。只进证据行，不进分。 */
	value: string;
	/** 命中的那一类，决定可信度那一档。 */
	route: Route;
	/** 说法与这一类原文的相关度，已过 RELEVANCE_MIN */
	relevance: number;
	/**
	 * 命中的那条说法的文本，只有抽取的两类带（其余类的文本就是经历行上的
	 * 字段，回表取得到；简历原文太长，不放进事实行）。不参与计算，只为在
	 * 证据行上说出「命中的是哪个能力词」。
	 */
	phrase: string | null;
	/** 做过的事那一类的参与方式（「从零搭建」），其余类为 null。只为证据行显示。 */
	involvement: string | null;
	/** null 表示至今 */
	endDate: string | null;
};

/**
 * 两条证据谁更强：先比可信度那一档，同档比相关度。一条主张的几个经历词同权：
 * 它们都是模型对「要找什么」的表达，没有哪个更像原话。
 */
function stronger(a: Fact, b: Fact) {
	return (
		strengthRank(strengthOf(b.route)) - strengthRank(strengthOf(a.route)) ||
		a.relevance - b.relevance
	);
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
 * 一条主张对一个人说两件事：**可信度**是一档，**深度**是一个数。
 *
 * **可信度**取该人所有命中段里最强的一条证据所在的档。做过三段算法不比做过
 * 一段更「做过」，所以它不累加，回答的是「最可信的那条证据有多能说明他真的做过」。
 *
 * **深度 = 相关度 × 时长 × 近因**，三个都是 (0, 1] 内的因子。相关度取最强那条
 * 证据的；**时长是全部命中段的累计**，近因取其中最近的一段。它们回答的是
 * 「他在这件事上沉淀了多久、离开多久」，一段简历里提过的算法经历也是算法经历。
 * 深度不会压过可信度：按证据排时它只在同一档之内比先后（`rank`）。
 * 主张上的 `minMonths` 判的就是这个累计值：筛和排看的是同一个数，证据行上写的也是它。
 */
function claimValue(facts: Fact[], now: Date) {
	let best: Fact | undefined;
	for (const f of facts) if (!best || stronger(f, best) > 0) best = f;
	if (!best) return null;
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
		strength: strengthOf(best.route),
		depth:
			best.relevance * saturate(months, TENURE_HALF) * decay(gap, RECENCY_HALF),
		basis: {
			route: best.route,
			value: best.value,
			relevance: best.relevance,
			months,
			endDate: endDate ?? null,
			external,
		} satisfies ClaimBasis,
	};
}

/**
 * 累计命中段的月数；同一段 id 只计一次。
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

/** 满足这条主张：有证据段，而且累计时长够。 */
function satisfies(claim: Claim, facts: Fact[] | undefined): facts is Fact[] {
	if (!facts || facts.length === 0) return false;
	return !claim.minMonths || monthsOf(facts) >= claim.minMonths;
}

/** 一个人在一次检索里的全部事实：主张下标 → 命中的段 */
type Person = Map<number, Fact[]>;

/** 一条事实放进这个人按主张归拢的那一格。 */
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
 * 加分的主张不参与，这就是它「加分」的全部含义：只进分数，不进判定。
 *
 * 证据有多可信不在这里问。它是排序的第一个依据（`byEvidence`）：登记证据的人整体
 * 排在自述证据的人前面，每一行旁边的圆点还标着证据的可信度。拿它决定去留的话，
 * 一个人是从名单里消失，而屏幕上没有任何东西能说明他本来在哪。
 */
function complete(p: Person, claims: Claim[]) {
	for (const [i, claim] of claims.entries()) {
		if (claim.mode !== "must") continue;
		if (!satisfies(claim, p.get(i))) return false;
	}
	return true;
}

/**
 * 一个人的两项依据。
 *
 * **可信度**取必须的主张里最弱的那一档：名单说「这个人满足全部必须条件」，
 * 这句话只有它最弱的那条证据那么可信。加分的主张不参与——一条可有可无的主张
 * 证据再可信，也不该拉高必须主张的可信度。
 *
 * **深度 = 必须主张的乘积 × 加分主张的抬升 × 人的偏好的抬升。** 必须主张之间是
 * 乘积：一条浅，整个人就被压下去。淘汰由 `complete` 负责，不是由乘积负责——
 * 加分那一半恒大于 1，只抬不压，所以不会出现「命中得越少分越高」。满足的每
 * 一条偏好（人的条件和背景，见 `result.ts` 的 `Gate`）各乘一次 `BOOST_WEIGHT`：
 * 「最好字节来的」和「最好是硕士」满足一条就该得一条的分，不看在字节待了多久。
 */
function measure(
	p: Person,
	claims: Claim[],
	preferred: readonly ReadonlySet<string>[],
	empId: string,
	now: Date,
) {
	let strength: Strength = "controlled";
	let depth = 1;
	const basis: (ClaimBasis | null)[] = [];
	for (const [i, claim] of claims.entries()) {
		const fs = p.get(i);
		const value = claimValue(fs ?? [], now);
		if (claim.mode === "must") {
			// `complete` 已经保证必须的主张都有证据；没有就是调用方漏了判定
			if (!value) throw new Error(`必须的主张 ${i} 没有证据却进了打分`);
			basis.push(value.basis);
			depth *= value.depth;
			if (strengthRank(value.strength) > strengthRank(strength))
				strength = value.strength;
		} else if (value && satisfies(claim, fs)) {
			// 够不上时长的加分主张不加分，依据也不留：留了它就会画成一行命中，
			// 而名次里没有它——「看得见的东西能解释看到的名次」就不成立了
			basis.push(value.basis);
			depth *= 1 + BOOST_WEIGHT * value.depth;
		} else basis.push(null);
	}
	for (const set of preferred) if (set.has(empId)) depth *= 1 + BOOST_WEIGHT;
	return { strength, depth, basis };
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

/**
 * 没有经历主张时，人员按满足的加分门槛数排序，再按工号排序。
 * 没有工作经历的人员事实仍可参与人员筛选，空经历属性不产生经历分面。
 */
export function rankPopulation(
	facts: PopulationFact[],
	filters: SearchFilters,
	/** 每条人的偏好各一份满足它的人（`search.ts` 的 `fetchPreferred`）。 */
	preferred: readonly ReadonlySet<string>[] = [],
): { empIds: string[]; facets: Facets; total: number } {
	// 没有分数可排的路上，偏好就是唯一的先后：满足得多的在前，其余按工号
	const met = (id: string) => preferred.filter((set) => set.has(id)).length;
	const empIds = [
		...new Set(facts.filter(keeps(filters)).map((fact) => fact.empId)),
	].sort((a, b) => met(b) - met(a) || a.localeCompare(b));
	const facets = emptyFacets();
	for (const key of DIM_KEYS)
		fill(
			facets,
			key,
			facetRows(facts, key, filters, () => true),
		);
	return { empIds, facets, total: empIds.length };
}

type Ranked = {
	empId: string;
	strength: Strength;
	depth: number;
	basis: (ClaimBasis | null)[];
};

/**
 * 名次：先比可信度那一档，同档比深度，同分按工号。
 *
 * 同分按工号保持确定的顺序，增加 limit 翻页时已有名单逐位不变。
 */
function byEvidence(a: Ranked, b: Ranked) {
	return (
		strengthRank(a.strength) - strengthRank(b.strength) ||
		b.depth - a.depth ||
		a.empId.localeCompare(b.empId)
	);
}

/**
 * 对同一份事实计算名次与分面。now 是本次检索的共同时间依据。
 */
export function rank(
	facts: Fact[],
	claims: Claim[],
	filters: SearchFilters,
	now: Date,
	/** 每条人的偏好各一份满足它的人（`search.ts` 的 `fetchPreferred`）。 */
	preferred: readonly ReadonlySet<string>[] = [],
): { ranked: Ranked[]; facets: Facets; total: number } {
	const ranked: Ranked[] = [];
	for (const [empId, p] of bucket(facts, keeps(filters))) {
		if (!complete(p, claims)) continue;
		ranked.push({ empId, ...measure(p, claims, preferred, empId, now) });
	}
	ranked.sort(byEvidence);
	return {
		ranked,
		facets: computeFacets(facts, claims, filters),
		total: ranked.length,
	};
}

/**
 * 这一页的人各自留哪几段经历当证据。
 *
 * 只对已经定好名次的那一页算，所以它不进排序的开销。排序键：证据强的在前
 * （`stronger`：先档后相关度），再取长的，再按 id——展示顺序必须是确定的，否则
 * 同一次查询刷新两次证据会换位置。这里刻意不用主张的深度：那是**人**的属性
 * （累计、近因都跨段），而这里要选的是单独一段，两者不是同一个量。
 *
 * 没满足的主张一段都不留（`satisfies`，和打分同一条判定）：够不上累计时长的
 * 加分主张在名次里没有份，证据行和时间线上也不能有它。
 */
/** 「这个人的这条主张」的复合 key：工号里不可能出现的字符。 */
const PER_CLAIM = "\u0001";

export function pageHits(
	facts: Fact[],
	claims: readonly Claim[],
	filters: SearchFilters,
	empIds: Set<string>,
	perClaim: number,
): Map<string, Fact[]> {
	const keep = keeps(filters);
	// 按人和主张收集证据，桶保留其人员身份。
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
		if (!claim || !satisfies(claim, list)) continue;
		list.sort((a, b) => stronger(b, a) || b.months - a.months || a.id - b.id);
		const acc = out.get(empId) ?? [];
		acc.push(...list.slice(0, perClaim));
		out.set(empId, acc);
	}
	// 主张的顺序即行序：结果里每个人的每条证据对应一条主张，按下标排好再返回
	for (const list of out.values())
		list.sort(
			(a, b) => a.claim - b.claim || stronger(b, a) || b.months - a.months,
		);
	return out;
}
