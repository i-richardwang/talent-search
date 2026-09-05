/**
 * 打分、AND 判定、排序、分面——一次检索里除了「取数」之外的全部逻辑。
 *
 * 这个文件**没有 SQL，也没有数据库**。检索层只负责回答「哪些经历段命中了哪个
 * 要求」这个纯事实问题，剩下的全部在这里对内存里的事实求值。
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
	emptyFacets,
	type Facets,
	type SearchFilters,
	type TermBasis,
	type TermPlan,
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
 * 一段经历对一条要求的命中。这是检索层唯一的产物：**事实，不含任何评分**。
 *
 * 字段只有两类：打分要用的（route / relevance / months / endDate）和分面要分组的
 * （那几维要读哪些列由 `DimSource` 声明，跟着维度走）。`id` 只用来在定好名次
 * 之后回表取展示用的原文；`memberIdx` 只用来在出结果时说出「命中的是哪个
 * 说法」——都不参与计算。
 */
export type PopulationFact = DimSource & { empId: string };

export type Fact = PopulationFact & {
	id: number;
	termIdx: number;
	/** 命中的是这条要求的第几个说法（TermPlan.members 的下标） */
	memberIdx: number;
	route: Route;
	/** 说法与这一路原文的相关度，已过 RELEVANCE_MIN */
	relevance: number;
	/** null 表示至今 */
	endDate: string | null;
};

/**
 * 一条证据的强度 = 路权重 × 相关度。两个都是「这条证据有多能说明他真的
 * 做过用户要的那件事」的因子：前者管字段是谁写的，后者管原文离用户的意思多远。
 */
function evidenceWeight(f: Fact) {
	return ROUTE_WEIGHTS[f.route] * f.relevance;
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
	if (!match) throw new Error(`无效结束日期：${endDate}`);
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const m = (now.getFullYear() - year) * 12 + (now.getMonth() - month);
	return m > 0 ? m : 0;
}

/**
 * 一条要求对一个人的分数 = **强度 × 时长 × 近因**，三个都是有界因子。
 *
 * **强度**取该人所有命中段里最硬的一条证据（路权重 × 相关度，见
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
	let best: Fact | undefined;
	for (const f of facts)
		if (!best || evidenceWeight(f) > evidenceWeight(best)) best = f;
	if (!best) return { score: 0, basis: null };
	const strength = evidenceWeight(best);
	let months = 0;
	let gap = Number.POSITIVE_INFINITY;
	let endDate: string | null | undefined;
	// 只有全部段都来自入职前，这个累计值才配叫「前」（见 result.ts 的 external）
	let external = true;
	for (const f of facts) {
		if (evidenceWeight(f) < strength) continue;
		months += f.months;
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
			term,
			route: best.route,
			relevance: best.relevance,
			months,
			endDate: endDate ?? null,
			external,
		} satisfies TermBasis,
	};
}

/** 一个人在一次检索里的全部事实：要求下标 → 命中的段 */
type Person = Map<number, Fact[]>;

/** 把一个人的事实按要求归拢。AND 判定问的是「每条要求都有段吗」。 */
function byTerm(facts: readonly Fact[]): Person {
	const p: Person = new Map();
	for (const f of facts) {
		const list = p.get(f.termIdx);
		if (list) list.push(f);
		else p.set(f.termIdx, [f]);
	}
	return p;
}

/** 按人、按词归拢通过 `keep` 的事实；后续计算只读取这份稳定集合。 */
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
 * **语义检索和结构化范围走的是同一份实现**，差别只在 `admits`：前者要凑齐
 * 全部必须词（AND），后者没有语义证据可言、人人算数。各写一份的话，同一栏
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
	terms: TermPlan[],
	filters: SearchFilters,
): Facets {
	const out = emptyFacets();
	for (const key of DIM_KEYS)
		fill(
			out,
			key,
			facetRows(facts, key, filters, (person, strong) =>
				complete(byTerm(person), terms, strong),
			),
		);

	// 「证据要求」这一维的两头：打开还剩几个（on）、关掉能看到几个（off）。
	// 两个数都把证据要求自己摘掉之后再算。
	for (const p of bucket(facts, keeps(filters, "strong")).values()) {
		if (!complete(p, terms, false)) continue;
		out.strong.off++;
		if (complete(p, terms, true)) out.strong.on++;
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
 * 结构化范围没有语义证据：一段经历落在范围里，这个人就算数。
 *
 * 「证据够不够硬」问的不是这批事实，所以证据要求在这里被摘掉；其余各维走的是
 * 和语义检索**同一份** `facetRows`——值域只看这次查询、计数摘掉这一维自己的
 * 筛选。两条路各写一份分面的话，同一栏筛选在结构化查询下会变成「点一项，
 * 其余项当场消失」。
 */
export function rankPopulation(
	facts: PopulationFact[],
	filters: SearchFilters,
): { empIds: string[]; facets: Facets; total: number } {
	const effective = { ...filters, strong: undefined };
	const empIds = [
		...new Set(facts.filter(keeps(effective)).map((fact) => fact.empId)),
	].sort();
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
	ranked.sort((a, b) => b.score - a.score || a.empId.localeCompare(b.empId));
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
/** 「这个人的这条要求」的复合 key：工号里不可能出现的字符。 */
const PER_TERM = "\u0001";

export function pageHits(
	facts: Fact[],
	filters: SearchFilters,
	empIds: Set<string>,
	perTerm: number,
): Map<string, Fact[]> {
	const keep = keeps(filters);
	// 桶自己带着它是谁的：从第一条事实上反读工号的话，「空桶怎么办」就成了一个
	// 得回答的问题，而空桶根本造不出来。
	const byKey = new Map<string, { empId: string; facts: Fact[] }>();
	for (const f of facts) {
		if (!empIds.has(f.empId) || !keep(f)) continue;
		const k = f.empId + PER_TERM + f.termIdx;
		const bucket = byKey.get(k);
		if (bucket) bucket.facts.push(f);
		else byKey.set(k, { empId: f.empId, facts: [f] });
	}
	const out = new Map<string, Fact[]>();
	for (const { empId, facts: list } of byKey.values()) {
		list.sort(
			(a, b) =>
				evidenceWeight(b) - evidenceWeight(a) ||
				b.months - a.months ||
				a.id - b.id,
		);
		const acc = out.get(empId) ?? [];
		acc.push(...list.slice(0, perTerm));
		out.set(empId, acc);
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
