/**
 * 筛选维度的**唯一声明**：一维一段，写在一起。
 *
 * 在这个文件出现之前，「入职前公司档」这个维度在代码里并不存在——存在的是十几
 * 处碰巧都提到了 `companyTag` 的代码：查询范围里的一个字段、URL 里的一个字段、
 * 两处清洗、SQL 里的一个条件、内存里的一个条件、算候选值的一个 switch 分支、
 * 排序规则里的一行、筛选面板里的一行、中文名的一个 case。加一维要手工重演这
 * 十几步，漏一步不会报错，只会算错。
 *
 * 所以这里声明的是**维度本身**，其余各处从它派生：
 *
 * - `values` 一处声明，供出三样东西——分面有哪些候选、每个候选几个人、以及
 *   「这个人过不过这一维的筛选」。它们过去是三段各自手写的代码，而三者一旦
 *   对不上，症状是分面预告的数点下去得不到（`tests/search.test.ts` 对此有断言）。
 * - `parse` 供出唯一那处清洗（`params.ts` 的 `parsePopulation`），URL、RPC、
 *   查询范围三处都走它。
 * - `label` / `option` / `text` 供出筛选栏标题、选项文案与范围标签。
 * - SQL 那一份在 `search.ts`：谓词由这里的 `match` 家族和那里的一条列表达式
 *   一起推出来，不是第二份手写实现。它没法住在这里——这个文件要进客户端。
 *
 * **为什么谓词必须求值两次。** 查询自带的范围可以直接下推给数据库裁人；筛选栏
 * 里勾的不行，因为筛选栏还要回答「再勾一项会剩几人」，那个数只有把没筛之前的
 * 完整事实端在手里才算得出来。所以是「一份声明、两个通用求值器」，而不是
 * 「一份谓词」——求值器各写一次，和维度有几个无关。
 *
 * **范围与筛选是同一维的两种生命周期**，形状因此完全相同（`Picked`）：前者
 * 来自那句原话、随记录保存，后者来自 URL、一次性，搜索时取交集。
 *
 * 公司名（`org`）与学校名（`school`）不在这里：它们是自由文本的模糊匹配、没有
 * 候选列表，硬塞进同一张表就得给每一项加一个「匹配方式」的分叉，那是用一个
 * 形状盖住两件不同的事。它们是另一类，见 `SearchFilters`。
 */
import { duration } from "#/lib/format";
import { boundedText } from "./text";
import { MIN_MONTHS_BUCKETS } from "./weights";

/**
 * 选中的一条序列。二级序列名跨一级会重名（技术/数据科学 与 商业分析/数据科学），
 * 所以它是一对值，不是一个名字。
 *
 * 从 URL 到 SQL 谓词全程都是这个形状，中间不拼成字符串再切开：序列名里出现斜杠
 * 并不稀奇，任何拼接式的编码都会在某个名字上切错，而切错的表现是一份说不通的
 * 名单，不是一个报错。（`id` 那条内部身份用的是数据里不可能出现的字符。）
 */
export type SeqPick = { l1: string; l2: string };

/** 每一维**一个取值**的类型。选中的那些是它的集合还是它本身，由 `Picked` 说。 */
export type DimUnit = {
	seq: SeqPick;
	level: string;
	kind: "internal" | "external";
	minMonths: number;
	companyTag: string;
	skill: string;
	recruitment: string;
	education: string;
};

export type DimKey = keyof DimUnit;

/**
 * 集合维：一维之内可以选多项，它们之间是「或」。
 *
 * 其余两维不是集合，多选对它们没有意义：「至少 6 个月」或「至少 1 年」加起来
 * 还是「至少 6 个月」，「在职」和「入职前」两个都要就是不筛。
 */
const MULTI_KEYS = [
	"seq",
	"level",
	"companyTag",
	"skill",
	"recruitment",
	"education",
] as const;
type MultiKey = (typeof MULTI_KEYS)[number];

/** 这一维能不能多选。写回 URL 的形状看它，所以运行时也要知道这件事。 */
export function isMulti(key: DimKey): boolean {
	return (MULTI_KEYS as readonly string[]).includes(key);
}

/**
 * 一次选择。查询自带的范围和 URL 上的筛选共用它——同一维在两种生命周期下
 * 取值形状相同，是这张表能只写一遍的前提。
 */
export type Picked = {
	[K in DimKey]?: K extends MultiKey ? DimUnit[K][] : DimUnit[K];
};

/** 分面取值要读一段经历上的这几列。事实的形状因此跟着声明走。 */
export type DimSource = {
	months: number;
	/** 登记的序列，入职前的段是模型对齐的序列（`search.ts` 的 `FACT_COLUMNS`） */
	seqL1: string;
	seqL2: string;
	companyTag: string | null;
	/** 这一段抽出来的能力词，已按对照表换成标准词（`src/corpus/aliases.ts` 的整理任务定期归并）。没有就是空数组 */
	skills: string[];
	kind: "internal" | "external";
	level: string;
	recruitment: string;
	education: string;
};

/** 分面里的一行：一个候选取值和它下面的人数。 */
export type Facet<K extends DimKey = DimKey> = { value: DimUnit[K]; n: number };

/**
 * 怎么算命中。只有两个家族，各写一次求值器：
 *
 * - `set`：取值落在选中的那几个里。
 * - `atLeast`：一条阈值。候选档位由 `MIN_MONTHS_BUCKETS` 给出（一段 36 个月的
 *   经历同时算进 6/12/24/36 四档），但判定用的是原值——手拼的 `minMonths=7`
 *   仍然按 7 个月生效，而不是因为它不在档位上就静默筛空。
 */
type Match<K extends DimKey> =
	| { match: "set"; values: (fact: DimSource) => DimUnit[K][] }
	| { match: "atLeast"; measure: (fact: DimSource) => number };

type Dimension<K extends DimKey> = Match<K> & {
	/** 维度名。筛选栏的分区标题、范围标签的前缀都读它。 */
	label: string;
	/** 分桶与比较用的内部身份。不出现在 URL 上。 */
	id: (value: DimUnit[K]) => string;
	/** 一个取值在筛选栏里怎么写。分区标题已经说了是什么的，这里不必重复。 */
	option: (value: DimUnit[K]) => string;
	/** 这个取值单独拎出来怎么念（查询范围的标签）。默认是「维度名 · 取值」。 */
	text?: (value: DimUnit[K]) => string;
	/** 不可信输入 → 这一维的取值。URL 与 RPC 共用。 */
	parse: (raw: unknown) => Picked[K];
	/** 候选怎么排。 */
	compare: (a: Facet<K>, b: Facet<K>) => number;
};

/**
 * 一维最多能同时选中几项。分面里最长的那一维（序列）也就几十项，全勾上都到不了
 * 这个数——超过它的只可能是手拼的 URL，而每多一项，取数之后的每一条事实都要多比
 * 一次。
 */
export const FILTER_LIST_MAX = 64;

/**
 * 一列不可信的文本。空列表收成 `undefined`——「一项都没选」和「这一维不筛」是同
 * 一件事，留一个空数组在 URL 上只会让筛选栏数出一项没有行可以点掉的筛选
 * （`activeCount`）。哪些串不算这一维的取值由维度自己说（`plain` 的 `isValue`）。
 * 公司名与学校名（`params.ts`）走同一条：它们不在这张表里，但「一列名字」和
 * 「一列取值」是同一种东西，上限也是同一个。
 */
export function textList(input: unknown): string[] | undefined {
	if (!Array.isArray(input)) return undefined;
	const out = [
		...new Set(
			input.map(boundedText).filter((v): v is string => v !== undefined),
		),
	].slice(0, FILTER_LIST_MAX);
	return out.length > 0 ? out : undefined;
}

/** 合成 id 的分隔符：序列名里出现「/」并不稀奇，得用数据里不可能出现的字符。 */
const SEP = "\u0001";

/**
 * 取值即标签的那几维里，这些串**不是取值**：「未知」说的是「这一项没被标过」，
 * 不是一个公司档、一个学历。
 *
 * 它声明在这一处，三个求值器都从它派生——分面候选（`values`）、不可信输入的
 * 清洗（`parse`）、以及给模型的语料词表（`search.ts` 的 `vocabulary`）。
 * 分家的话，一个「未知」能被写进 URL、下推成 `in ('未知')` 选中一批行，
 * 而内存里的谓词当场把它们否掉——屏幕上是一个选中了却空着的筛选。
 */
export const NOT_A_VALUE = ["未知"] as const;

const byCountThenValue = (
	a: { value: string; n: number },
	b: { value: string; n: number },
) => b.n - a.n || a.value.localeCompare(b.value, "zh-Hans-CN");

/**
 * 取值即标签的那几个集合维（职级、公司档、招聘渠道、学历）共用这一份声明：
 * 从事实的哪一列读、哪些串不算取值，都只说一次。
 */
function plain(label: string, column: (fact: DimSource) => string | null) {
	const isValue = (v: string | null): v is string =>
		Boolean(v) && !(NOT_A_VALUE as readonly string[]).includes(v as string);
	return {
		label,
		match: "set" as const,
		values: (fact: DimSource) => {
			const value = column(fact);
			return isValue(value) ? [value] : [];
		},
		id: (v: string) => v,
		option: (v: string) => v,
		parse: (raw: unknown) => {
			// 筛掉不算取值的之后可能一个不剩：那和「这一维不筛」是同一件事，
			// 留一个空数组会让「有没有筛选」说谎。
			const values = textList(raw)?.filter(isValue);
			return values && values.length > 0 ? values : undefined;
		},
		compare: byCountThenValue,
	};
}

/**
 * 八个维度。这张表是它们在全站的唯一定义。
 *
 * 顺序就是筛选栏里从上到下的顺序，也是查询范围标签的顺序。
 */
export const DIMENSIONS: { [K in DimKey]: Dimension<K> } = {
	seq: {
		label: "序列",
		match: "set",
		// 两级都要有值：只有一级的话身份会编码成「技术」加一个空的二级，
		// 而那不是任何一个选项点得出来的东西。
		values: (f) => (f.seqL1 && f.seqL2 ? [{ l1: f.seqL1, l2: f.seqL2 }] : []),
		id: (v) => v.l1 + SEP + v.l2,
		// 二级序列名跨一级会重名，一级省不掉
		option: (v) => `${v.l1} · ${v.l2}`,
		parse: (raw) => {
			if (!Array.isArray(raw)) return undefined;
			const out: SeqPick[] = [];
			for (const item of raw.slice(0, FILTER_LIST_MAX)) {
				const pick = (item ?? {}) as Record<string, unknown>;
				const l1 = boundedText(pick.l1);
				const l2 = boundedText(pick.l2);
				if (l1 && l2 && !out.some((s) => s.l1 === l1 && s.l2 === l2))
					out.push({ l1, l2 });
			}
			return out.length > 0 ? out : undefined;
		},
		compare: (a, b) =>
			b.n - a.n ||
			a.value.l1.localeCompare(b.value.l1, "zh-Hans-CN") ||
			a.value.l2.localeCompare(b.value.l2, "zh-Hans-CN"),
	},

	level: {
		...plain("职级", (f) => f.level),
		text: (v) => `当前职级 · ${v}`,
		// 职级按名字排：它是有序的量（P5 < P6），人多的档不一定是低的档
		compare: (a, b) => a.value.localeCompare(b.value, "zh-Hans-CN"),
	},

	kind: {
		label: "经历来源",
		match: "set",
		values: (f) => [f.kind],
		id: (v) => v,
		option: (v) => (v === "internal" ? "公司内经历" : "入职前经历"),
		// 已经说全了是什么，再加一个维度名前缀就是同一句话说两遍
		text: (v) => (v === "internal" ? "公司内经历" : "入职前经历"),
		parse: (raw) =>
			raw === "internal" || raw === "external" ? raw : undefined,
		compare: (a, b) => b.n - a.n || a.value.localeCompare(b.value),
	},

	minMonths: {
		label: "经历时长",
		match: "atLeast",
		measure: (f) => f.months,
		id: (v) => String(v),
		option: (v) => duration(v),
		text: (v) => `一份经历至少 ${duration(v)}`,
		// 收得最紧的一维：它是唯一参与数值比较的筛选，负数会让它恒真
		// （`months >= -999`），小数会渲染出「1 年 0.5 个月」这种档位——
		// 两者都不报错，只会安静地给出说不通的结果。
		parse: (raw) => {
			const months = Number(raw);
			return Number.isInteger(months) && months > 0 ? months : undefined;
		},
		// 档位按档位排：它是有序的量，不是并列的类别
		compare: (a, b) => a.value - b.value,
	},

	companyTag: {
		...plain("入职前公司", (f) => f.companyTag),
		text: (v) => `入职前公司 · ${v}`,
	},

	skill: {
		label: "入职前技能",
		match: "set",
		// 唯一一段有多个取值的维。能力词只从入职前经历的简历描述里抽（src/corpus/extract.ts），
		// 而只有三分之一的人有描述：勾任何一项都把没写简历的人整个筛掉。这一维能回答
		// 「谁写过」，回答不了「谁不会」——搜索框里敲能力词没有这个问题，没简历的人
		// 靠岗位名排后面，不消失。
		values: (f) => f.skills,
		id: (v) => v,
		option: (v) => v,
		text: (v) => `技能 · ${v}`,
		parse: textList,
		compare: byCountThenValue,
	},

	recruitment: plain("招聘渠道", (f) => f.recruitment),

	education: plain("学历", (f) => f.education),
};

/** 全部维度，按声明顺序。加一维只要在上面加一段，其余各处跟着长。 */
export const DIM_KEYS = Object.keys(DIMENSIONS) as DimKey[];

/**
 * 有语料词表的那几维：查询理解时模型只能从库里真实存在的取值里挑。其余三维挑
 * 不了——序列要先知道全套序列树，经历来源是二选一，经历时长是连续量。
 *
 * 取值从哪张表数出来是 SQL 那一半的事（`search.ts` 的 `VOCAB_SOURCE`），那份表
 * 按这里穷尽；词表本身的形状（`intent.ts` 的 `Vocabulary`）也从这里长出来。
 */
export const VOCAB_KEYS = [
	"companyTag",
	"level",
	"recruitment",
	"education",
] as const satisfies readonly DimKey[];

export type VocabKey = (typeof VOCAB_KEYS)[number];

/** 一段经历在这一维上的候选取值。空值不出现：它说的是「没记录」，不是取值。 */
export function dimValues<K extends DimKey>(
	key: K,
	fact: DimSource,
): DimUnit[K][] {
	const dim = DIMENSIONS[key];
	return dim.match === "set"
		? dim.values(fact)
		: (MIN_MONTHS_BUCKETS.filter(
				(bucket) => dim.measure(fact) >= bucket,
			) as DimUnit[K][]);
}

/** 这一段经历过不过这一维的筛选。没选就是不筛。 */
export function dimMatches<K extends DimKey>(
	key: K,
	picked: Picked[K],
	fact: DimSource,
): boolean {
	if (picked === undefined) return true;
	const dim = DIMENSIONS[key];
	if (dim.match === "atLeast") return dim.measure(fact) >= (picked as number);
	const ids = new Set(dimPicked<K>(picked).map((v) => dim.id(v)));
	return dim.values(fact).some((v) => ids.has(dim.id(v)));
}

/** 这一维选中的那些取值，摊平成一列——集合维给多个，单值维给一个。 */
export function dimPicked<K extends DimKey>(picked: Picked[K]): DimUnit[K][] {
	if (picked === undefined) return [];
	return (Array.isArray(picked) ? picked : [picked]) as DimUnit[K][];
}

/** 分桶与比较用的内部身份。 */
export function dimId<K extends DimKey>(key: K, value: DimUnit[K]): string {
	return DIMENSIONS[key].id(value);
}

/** 候选怎么排。 */
export function dimCompare<K extends DimKey>(
	key: K,
	a: Facet<K>,
	b: Facet<K>,
): number {
	return DIMENSIONS[key].compare(a, b);
}

/** 一个取值在筛选栏里怎么写。 */
export function dimOption<K extends DimKey>(key: K, value: DimUnit[K]): string {
	return DIMENSIONS[key].option(value);
}

/** 一个取值单独拎出来怎么念（查询范围的标签）。 */
export function dimText<K extends DimKey>(key: K, value: DimUnit[K]): string {
	const dim = DIMENSIONS[key];
	return dim.text?.(value) ?? `${dim.label} · ${dim.option(value)}`;
}

/** 不可信输入 → 一次完整的选择。全站唯一那处清洗（`parsePopulation`）从这里来。 */
export function parsePicked(raw: Record<string, unknown>): Picked {
	const out: Record<string, unknown> = {};
	for (const key of DIM_KEYS) {
		const value = DIMENSIONS[key].parse(raw[key]);
		if (value !== undefined) out[key] = value;
	}
	return out as Picked;
}

/**
 * 从一次选择里摘掉一个取值。集合维摘掉这一项，单值维就是摘掉这一维；摘空了的
 * 维度整个消失——留一个空列表会让「有没有筛选」说谎。
 */
export function dropValue<P extends Picked, K extends DimKey>(
	picked: P,
	key: K,
	value: DimUnit[K],
): P {
	const id = dimId(key, value);
	const rest = dimPicked(picked[key]).filter((v) => dimId(key, v) !== id);
	const next = { ...picked };
	if (rest.length === 0 || !Array.isArray(picked[key])) delete next[key];
	else Object.assign(next, { [key]: rest });
	return next;
}
