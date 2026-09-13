/**
 * 打分、AND 判定、排序、分面——一次检索里除了「取数」之外的全部逻辑。
 *
 * 这个文件**没有 SQL，也没有数据库**。检索层只负责回答「哪些经历段命中了哪条
 * 主张」这个纯事实问题，剩下的全部在这里对内存里的事实求值。
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
	DIM_KEYS,
	type DimKey,
	type DimSource,
	type DimUnit,
	dimCompare,
	dimId,
	dimMatches,
	dimValues,
	type Facet,
} from "./dimensions";
import {
	type Claim,
	type ClaimBasis,
	emptyFacets,
	type Facets,
	type SearchFilters,
} from "./result";
import {
	BOOST_WEIGHT,
	isControlledRoute,
	RECENCY_FLOOR,
	RECENCY_HALF,
	ROUTE_WEIGHTS,
	type Route,
	TENURE_FLOOR,
	TENURE_HALF,
} from "./weights";

/**
 * 一段经历对一条主张的命中。这是检索层唯一的产物：**事实，不含任何评分**。
 *
 * 字段只有两类：打分要用的（route / relevance / months / endDate）和分面要
 * 分组的（那几维要读哪些列由 `DimSource` 声明，跟着维度走）。`id` 只用来
 * 在定好名次之后回表取展示用的原文；`value` 只在证据行上说出「命中的是
 * 哪个词」——都不参与计算。
 */
export type PopulationFact = DimSource & { empId: string };

export type Fact = PopulationFact & {
	id: number;
	/** 属于第几条主张 */
	claim: number;
	/** 命中的是这条主张的哪个经历词。只进证据行，不进分；不比文本的主张为 null。 */
	value: string | null;
	/**
	 * 命中的那一路。没有经历词的主张（「待过字节」）不比文本：这一段落在范围里
	 * 就是证据，为 null——它的可信度是登记字段那一档，强度 1。
	 */
	route: Route | null;
	/** 说法与这一路原文的相关度，已过 RELEVANCE_MIN；不比文本的主张恒为 1 */
	relevance: number;
	/**
	 * 命中的那条说法的文本，只有抽取的两路带（其余路的文本就是经历行上的
	 * 字段，回表取得到；简历原文太长，不随事实行走）。不参与计算，只为在
	 * 证据行上说出「命中的是哪个能力词」。
	 */
	phrase: string | null;
	/** 做过的事那一路的参与方式（「从零搭建」），其余路为 null。只为证据行显示。 */
	involvement: string | null;
	/** null 表示至今 */
	endDate: string | null;
};

/**
 * 一条证据的强度 = 路权重 × 相关度。两个都是「这条证据有多能说明他真的做过
 * 用户要的那件事」的因子：路权重管字段是谁写的，相关度管原文离查询词多远。
 * 一条主张的几个经历词同权：它们都是模型对「要找什么」的表达，没有哪个更像原话。
 * 不比文本的主张，证据就是登记的公司、来源与时长，强度 1。
 */
function evidenceWeight(f: Fact) {
	return (f.route === null ? 1 : ROUTE_WEIGHTS[f.route]) * f.relevance;
}

/** 这条证据是不是受控字段给的。落在范围里本身就是登记事实，算受控。 */
function controlled(f: Fact) {
	return f.route === null || isControlledRoute(f.route);
}

/**
 * 饱和函数：`x / (x + half)` 抬到下限之上。恒在 [floor, 1) 内、处处单调、
 * 没有断崖，所以拿它当因子永远不会把一段人口压平（见 weights.ts 的 TENURE_HALF）。
 */
function saturate(x: number, half: number, floor: number) {
	return floor + (1 - floor) * (x / (x + half));
}

/** 衰减函数：`half / (half + x)` 抬到下限之上。saturate 的镜像，x 越大越低。 */
function decay(x: number, half: number, floor: number) {
	return floor + (1 - floor) * (half / (half + x));
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
 * 一条主张对一个人的分数 = **强度 × 时长 × 近因**，三个都是有界因子。
 *
 * **强度**取该人所有命中段里最强的一条证据（路权重 × 相关度，见
 * evidenceWeight）。做过三段算法不比做过一段更「做过」，所以强度不累加，
 * 它回答的是「最强的那条证据有多能说明他真的做过」。
 *
 * **时长是全部命中段的累计**，近因取其中最近的一段。它们回答的是「他在这件事上
 * 沉淀了多久、离开多久」，一段简历里提过的算法经历也是算法经历；证据档位
 * 不会因此被翻盘——两个因子的下限刻意抬得很高（论证见 weights.ts 的 TENURE_FLOOR），
 * 它们决定的是同一档证据内部的先后，不是证据的档次。主张上的 `minMonths`
 * 判的就是这个累计值：筛和排看的是同一个数，证据行上写的也是它。
 */
function claimValue(facts: Fact[], now: Date) {
	let best: Fact | undefined;
	for (const f of facts)
		if (!best || evidenceWeight(f) > evidenceWeight(best)) best = f;
	if (!best) return { score: 0, basis: null };
	const strength = evidenceWeight(best);
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
		score:
			strength *
			saturate(months, TENURE_HALF, TENURE_FLOOR) *
			decay(gap, RECENCY_HALF, RECENCY_FLOOR),
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
 * 这些证据段的累计月数。一段只计一次：同一段靠两个经历词各命中一回，取数 SQL
 * 已经去重（`search.ts` 的 textualFacts），这里再按段 id 认一遍，让「一段十二
 * 个月不会数成二十四」不依赖另一个文件的一条 distinct。
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
function file(p: Person, f: Fact) {
	const list = p.get(f.claim);
	if (list) list.push(f);
	else p.set(f.claim, [f]);
}

/** 把一个人的事实按主张归拢。AND 判定问的是「每条主张都有段吗」。 */
function byClaim(facts: readonly Fact[]): Person {
	const p: Person = new Map();
	for (const f of facts) file(p, f);
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
		file(p, f);
	}
	return byEmp;
}

/**
 * 这个人算不算数：**每条必须的主张**都得满足（AND 语义）；开了证据要求就还得
 * 每条必须的主张都有受控命中。
 *
 * 加分的主张不参与，这就是它「加分」的全部含义：只进分数，不进判定。证据要求
 * 同样只管必须的——要求一条可有可无的主张必须有受控证据，是自相矛盾的。
 */
function complete(p: Person, claims: Claim[], strong: boolean) {
	for (const [i, claim] of claims.entries()) {
		if (claim.mode !== "must") continue;
		const fs = p.get(i);
		if (!satisfies(claim, fs)) return false;
		if (strong && !fs.some(controlled)) return false;
	}
	return true;
}

/**
 * 总分 = 必须主张的乘积 × 加分主张的抬升 × 人的偏好的抬升。
 *
 * 必须主张之间是乘积：一条弱，整个人就被压下去。淘汰由 `complete` 负责，不是
 * 由乘积负责——加分那一半恒大于 1，只抬不压，所以不会出现「命中得越少分越高」。
 * 满足的每一条偏好各乘一次（`BOOST_WEIGHT`），经历上的和人上的一样：条件之间
 * 彼此独立，「最好字节来的」和「最好是硕士」满足一条就该得一条的分。
 */
function score(
	p: Person,
	claims: Claim[],
	preferred: readonly ReadonlySet<string>[],
	empId: string,
	now: Date,
) {
	let s = 1;
	const basis: (ClaimBasis | null)[] = [];
	for (const [i, claim] of claims.entries()) {
		const fs = p.get(i);
		const value = claimValue(fs ?? [], now);
		if (claim.mode === "must") {
			basis.push(value.basis);
			s *= value.score;
		} else if (satisfies(claim, fs)) {
			// 够不上时长的加分主张不加分，依据也不留：留了它就会画成一行命中，
			// 而名次里没有它——「看得见的东西能解释看到的名次」就此破掉
			basis.push(value.basis);
			s *= 1 + BOOST_WEIGHT * value.score;
		} else basis.push(null);
	}
	for (const set of preferred) if (set.has(empId)) s *= 1 + BOOST_WEIGHT;
	return { score: s, basis };
}

/** 算某一维的候选时要摘掉的那一维（口径见 `facetRows`）。 */
type Except = DimKey | "strong";

/**
 * 筛选谓词。逐维求值，谓词本身由 `dimensions.ts` 的声明给出——这里不认识任何
 * 一个具体维度，所以加一维不必来改它。
 *
 * `except` 是它带参数的全部理由：算「序列」这一维的候选时必须把序列自己的筛选
 * 摘掉，不摘的话选中一项之后其余项的计数全是 0，用户点不动第二次。
 */
function keeps(f: SearchFilters, except?: Except) {
	return (x: PopulationFact) =>
		DIM_KEYS.every((key) => key === except || dimMatches(key, f[key], x));
}

/**
 * 某一维的选项与人数。
 *
 * **有哪些行和每行几个人是两个口径**，这是这个函数的全部内容：
 *
 * - 值域（有哪些行）：只看这次查询，不看任何分面筛选。
 * - 人数（每行几个）：摘掉这一维自己的筛选，带上其余各维——不摘的话选中一项
 *   之后其余项全是 0，用户点不动第二次。
 *
 * 合成一个口径（只留数得出人的值）会让列表在手底下换形状：在职级里点一下 P6，
 * 序列那一栏凡是没有 P6 的行当场消失，而屏幕上没有任何东西说这是刚才那一下
 * 造成的。分开之后，被别的筛选挤成 0 的行留在原地写着 0——它是用户自己刚做的
 * 事的后果，藏起来就没法回头（界面上那一行是禁用的，见 `filter-rail.tsx`）。
 *
 * 数不出人的值仍然不进值域：全站几百个二级序列，和这次查询无关的那些列出来
 * 只是几千行噪音。公司名 / 学校名那两个精确条件在 SQL 里就把人裁掉了，所以它们
 * 照样收窄值域——那是「换了一批候选」，不是「在同一批里挑一部分」。
 *
 * 代价是同一份事实要走两遍。没有任何分面筛选时两遍结果相同，但那是运行时才
 * 知道的事，为它加一条快路要多养一个「两遍必须等价」的不变量。
 *
 * **语义检索和只有人的条件的查询走的是同一份实现**，差别只在 `admits`：前者要凑齐
 * 全部必须的主张（AND），后者没有语义证据可言、人人算数。各写一份的话，同一栏
 * 筛选在两种查询下是两种东西——一种点得动，另一种选中一项之后其余项归零。
 */
function facetRows<K extends DimKey, F extends PopulationFact>(
	facts: readonly F[],
	key: K,
	filters: SearchFilters,
	admits: (person: readonly F[], strong: boolean) => boolean,
): Facet<K>[] {
	const domain = tally(
		facts,
		key,
		() => true,
		(p) => admits(p, false),
	);
	const live = tally(facts, key, keeps(filters, key), (p) =>
		admits(p, Boolean(filters.strong)),
	);
	return [...domain].map(([id, { value }]) => ({
		value,
		n: live.get(id)?.n ?? 0,
	}));
}

/**
 * 一维上「哪个取值下有几个人」。`keep` 决定哪些事实参与，`admits` 决定一个人
 * 在这个取值下算不算数。数不出人的取值不进结果——值域与计数的差别由调用方
 * 用两套参数跑两遍表达，不在这里分叉。
 */
function tally<K extends DimKey, F extends PopulationFact>(
	facts: readonly F[],
	key: K,
	keep: (f: F) => boolean,
	admits: (person: readonly F[]) => boolean,
) {
	const byValue = new Map<
		string,
		{ value: DimUnit[K]; people: Map<string, F[]> }
	>();
	for (const f of facts) {
		if (!keep(f)) continue;
		for (const value of dimValues(key, f)) {
			const id = dimId(key, value);
			let bucket = byValue.get(id);
			if (!bucket) {
				bucket = { value, people: new Map() };
				byValue.set(id, bucket);
			}
			const list = bucket.people.get(f.empId);
			if (list) list.push(f);
			else bucket.people.set(f.empId, [f]);
		}
	}
	const out = new Map<string, { value: DimUnit[K]; n: number }>();
	for (const [id, bucket] of byValue) {
		let n = 0;
		for (const person of bucket.people.values()) if (admits(person)) n++;
		if (n > 0) out.set(id, { value: bucket.value, n });
	}
	return out;
}

/**
 * 各维度的选项与人数。
 *
 * 计数的口径是「在当前这次筛选下，选了这一项之后还剩多少人」；有哪些选项则
 * 只由这次查询决定，不随筛选变（见 `facetRows`）——一条会在手底下换形状的
 * 筛选栏，比一条长一点的更难用。
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
			facetRows(facts, key, filters, (person, strong) =>
				complete(byClaim(person), claims, strong),
			),
		);

	// 「证据要求」这一维的两头：打开还剩几个（on）、关掉能看到几个（off）。
	// 两个数都把证据要求自己摘掉之后再算。
	for (const p of bucket(facts, keeps(filters, "strong")).values()) {
		if (!complete(p, claims, false)) continue;
		out.strong.off++;
		if (complete(p, claims, true)) out.strong.on++;
	}
	return out;
}

/**
 * 把一维的候选放进结果，顺带按这一维自己的规则排好。
 *
 * 每一维的取值类型各不相同，而循环里的 `key` 是联合——TS 收不拢这份对应关系，
 * 只能在这一处断言。断言之外没有别的地方需要知道「哪一维是什么形状」。
 */
function fill(out: Facets, key: DimKey, rows: Facet[]) {
	Object.assign(out, {
		[key]: rows.sort((a, b) => dimCompare(key, a, b)),
	});
}

/**
 * 只有人的条件、没有经历主张的查询：人过了条件就算数，没有语义证据可言。
 *
 * 「证据够不够硬」问的不是这批事实，所以证据要求在这里被摘掉；其余各维走的是
 * 和语义检索**同一份** `facetRows`——值域只看这次查询、计数摘掉这一维自己的
 * 筛选。两条路各写一份分面的话，同一栏筛选在这种查询下会变成「点一项，
 * 其余项当场消失」。
 */
export function rankPopulation(
	facts: PopulationFact[],
	filters: SearchFilters,
	/** 每条人的偏好各一份满足它的人（`search.ts` 的 `fetchPreferred`）。 */
	preferred: readonly ReadonlySet<string>[] = [],
): { empIds: string[]; facets: Facets; total: number } {
	const effective = { ...filters, strong: undefined };
	// 没有分数可排的路上，偏好就是唯一的先后：满足得多的在前，其余按工号
	const met = (id: string) => preferred.filter((set) => set.has(id)).length;
	const empIds = [
		...new Set(facts.filter(keeps(effective)).map((fact) => fact.empId)),
	].sort((a, b) => met(b) - met(a) || a.localeCompare(b));
	const facets = emptyFacets();
	for (const key of DIM_KEYS)
		fill(
			facets,
			key,
			facetRows(facts, key, effective, () => true),
		);
	return { empIds, facets, total: empIds.length };
}

type Ranked = {
	empId: string;
	score: number;
	basis: (ClaimBasis | null)[];
};

/**
 * 一次检索的名次与分面。两者出自同一份事实，所以口径不可能分家。
 *
 * `now` 是入参而不是函数体里的 `new Date()`：近因让分数依赖「今天」，而依赖
 * 当前时间的函数是测不动的。调用方传一次，测试传一个固定的日期。
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
		if (!complete(p, claims, Boolean(filters.strong))) continue;
		ranked.push({ empId, ...score(p, claims, preferred, empId, now) });
	}
	// 同分按工号，排序才是确定的：翻页靠把 limit 调大重查，前一页必须逐位不变
	ranked.sort((a, b) => b.score - a.score || a.empId.localeCompare(b.empId));
	return {
		ranked,
		facets: computeFacets(facts, claims, filters),
		total: ranked.length,
	};
}

/**
 * 这一页的人各自留哪几段经历当证据。
 *
 * 只对已经定好名次的那一页算，所以它不进排序的开销。排序键：证据硬的在前，
 * 同档取长的，再同按 id——展示顺序必须是确定的，否则同一次查询刷新两次证据
 * 会换位置。这里刻意不用主张的分：那是**人**的属性（累计、近因都跨段），
 * 而这里要选的是单独一段，两者不是同一个量。
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
	// 桶自己带着它是谁的：从第一条事实上反读工号的话，「空桶怎么办」就成了一个
	// 得回答的问题，而空桶根本造不出来。
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
		list.sort(
			(a, b) =>
				evidenceWeight(b) - evidenceWeight(a) ||
				b.months - a.months ||
				a.id - b.id,
		);
		const acc = out.get(empId) ?? [];
		acc.push(...list.slice(0, perClaim));
		out.set(empId, acc);
	}
	// 主张的顺序即行序：结果里每个人的每条证据对应一条主张，按下标排好再交出去
	for (const list of out.values())
		list.sort(
			(a, b) =>
				a.claim - b.claim ||
				evidenceWeight(b) - evidenceWeight(a) ||
				b.months - a.months,
		);
	return out;
}
