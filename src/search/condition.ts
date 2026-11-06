/**
 * 旧的条件表形状：关键词链存的条件，以及较早的对话记录。读取时经 `compile.ts` 编译成
 * 查询（`query.ts`）再执行；新的对话轮次存的是查询本身，不再写这种形状。
 *
 * 一张条件表里有两种条件：
 *
 * - **经历主张**（`about: "experience"`）：这个人有一段（或几段）经历，**同时**满足写下的
 *   每一项——做过什么（`what`）、在哪（入职前的 `company` / `companyTag`，公司内的
 *   `department`）、什么时候（`kind`）、多久（`minMonths`，满足其余各项的段累计的月数）。
 * - **人的条件**（`about: "person"`）：职级、学历、招聘渠道、学校档、海外学历、学校。
 *   有高低的两维（职级档、学历）还可以说「某档及以上」（`atLeast`）。
 *
 *     { about: "experience", mode: "must", what: ["增长"], kind: "external", minMonths: 36 }
 *     { about: "person", mode: "boost", field: "level", atLeast: "P7" }
 *
 * 一条主张之内是同一段经历，条件之间是同一个人。这里还有校验不可信输入的边界
 * （`conditionsOf`）和语义词的长短上限（`termOf`），查询的形状校验共用后者。
 */
import {
	DIMENSIONS,
	type DimUnit,
	dimId,
	isOrdinal,
	type OrdinalKey,
	textList,
	type VOCAB_KEYS,
} from "./dimensions";
import { boundedText } from "./text";

/**
 * 一条条件的强度。
 *
 * - `must`：这个人必须满足。多条 must 之间是 AND。
 * - `boost`：满足了排前面，不满足也留在结果里。「这个人还得会点 X」和
 *   「会 X 更好」之间的差别，招聘里这两句话不是一句话。
 * - `exclude`：只对经历主张有意义。命中它的**经历段**不再算作任何主张的证据。
 *   否决的是证据，不是人——实习起步、后来真干了八年算法的人留下，因为他有
 *   别的证据；只有那段实习的人自然出不来，因为他没有证据了。
 *   人的条件没有排除：「不要校招的」在这套维度里该说成「社招」。
 */
export const MODES = ["must", "boost", "exclude"] as const;
export type Mode = (typeof MODES)[number];
/** 人的条件能有的强度：没有排除。 */
const PERSON_MODES = ["must", "boost"] as const;
export type PersonMode = (typeof PERSON_MODES)[number];

/** 人的条件能写在哪几维：有词表的几维是 `employee` 上的列，学校名是自由文本。 */
export const PERSON_FIELDS = [
	"level",
	"education",
	"recruitment",
	"schoolTier",
	"overseas",
	"school",
] as const;
type PersonField = (typeof PERSON_FIELDS)[number];
/** 人的条件里属于 `dimensions.ts` 那张表的几维；学校名不在表里。 */
export type PersonDim = Exclude<PersonField, "school">;

type Kind = DimUnit["kind"];

/**
 * 一条条件被停用。停用只有一个来源：用户在 chip 上点的。这条还在查询里、还画在
 * 屏幕上，但这一次检索完全当它不存在。招聘检索是反复试的——加一条发现只剩三个人，
 * 想知道是不是它太窄。删掉再手打回来会丢掉它的强度，也丢掉「我试过这个」这件事。
 *
 * 系统不替用户停用条件：用户说了的就搜，名单多长由用户看着人数决定。
 */
type Off = "user";

type Some<T> = readonly [T, ...T[]];

export type ExperienceCondition = {
	about: "experience";
	mode: Mode;
	/** 做过什么。取值 OR，都拿去比相似度；`what[0]` 是代表词。 */
	what?: Some<string>;
	/** 入职前在名字含这几个字之一的公司。专有名词，永远不进向量。 */
	company?: Some<string>;
	/** 公司内在名字或部门路径含这几个字之一的部门。 */
	department?: Some<string>;
	/** 在这几档公司之一。取值是词表里的档。 */
	companyTag?: Some<string>;
	/** 公司内的任职，还是入职前的经历。 */
	kind?: Kind;
	/** 满足其余各项的段累计至少这么多个月。 */
	minMonths?: number;
	off?: Off;
};

export type PersonCondition = {
	about: "person";
	mode: PersonMode;
	off?: Off;
} & (
	| {
			field: PersonField;
			/** 取值 OR。词表维写的是词表里的档，学校写名字。 */
			values: Some<string>;
	  }
	| {
			field: OrdinalKey;
			/** 这一档及以上的每一档。档的高低由库里的档高定（`search.ts` 的 `atLeastCond`）。 */
			atLeast: string;
	  }
);

export type Condition = ExperienceCondition | PersonCondition;

function isPersonDim(field: PersonField): field is PersonDim {
	return field !== "school";
}

/**
 * 一个经历词最长几个字。上限定义在这里，`submissionSchema` 的描述里不写数字：
 * 写成 schema 约束的话，模型多给一个长词就是整条响应作废，而校验只会丢掉那一个词。
 */
export const MAX_TERM_LEN = 24;

/** 一个经历词最短几个字。单字对语义匹配说不出任何东西。 */
export const MIN_TERM_LEN = 2;

/**
 * 不可信的一段字 → 一个经历词，或者什么都不是。
 *
 * 只做边界工作——去两头空白、限长度——不改写字面：屏幕上写的那几个字和拿去
 * 比相似度的那几个字是同一串，改写发生在哪里都是一次看不见的查询变更。
 */
export function termOf(value: unknown): string | undefined {
	const text = boundedText(value);
	if (!text || text.length < MIN_TERM_LEN || text.length > MAX_TERM_LEN)
		return undefined;
	return text;
}

/** 一条查询最多几条条件。再多就不是一句话能说清的了。 */
export const CONDITION_MAX = 12;

/**
 * 一条主张最多几个经历词。再多就不是一条主张了。
 *
 * 词表维不用这个数：「资深」在一份三条职级序列的词表上就是十几档，截到六档等于
 * 把其中一条序列整个丢掉。它们的上限是一维能同时选中几项（`FILTER_LIST_MAX`），
 * 和 URL 上的筛选同一条。
 */
export const VALUES_MAX = 6;

function whatOf(raw: unknown): string[] {
	const out: string[] = [];
	for (const item of Array.isArray(raw) ? raw : []) {
		const text = termOf(item);
		if (text && !out.includes(text)) out.push(text);
		if (out.length === VALUES_MAX) break;
	}
	return out;
}

/**
 * 一列不可信的取值 → 词表维上的取值，写成这一维自己的身份（`dimId`）。
 * 读不回来的丢掉：一个「资深」在屏幕上画得出来、在检索里却不筛任何人，那是
 * 一个名不副实的 chip。取值在不在**词表**里这里不查——RPC 这一侧没有词表，而模型
 * 那一侧是唯一会写出词表外取值的来源，它多一道检查（`intent.ts`）。
 */
function dimList<K extends (typeof VOCAB_KEYS)[number]>(
	key: K,
	raw: unknown,
): string[] {
	const picked = DIMENSIONS[key].parse(raw);
	return (picked ?? []).map((v) => dimId(key, v));
}

function some(list: readonly string[] | undefined): Some<string> | undefined {
	return list && list.length > 0
		? (list as unknown as Some<string>)
		: undefined;
}

/**
 * 不可信的一份条件列表 → 校验后的条件。模型输出和 RPC 入参走的是同一个入口：
 * 模型输出和 RPC 入参的不可信程度一样，上游声明过 schema 也省不掉这一道。
 *
 * 不合规的取值局部丢弃，不牵连整条；一项都不剩的条件整条消失。完全相同的
 * 条件只留第一条。人的条件没有排除（`PERSON_MODES`），带着排除的整条丢掉。
 */
export function conditionsOf(raw: unknown): Condition[] {
	const list: Condition[] = [];
	const seen = new Set<string>();
	for (const item of Array.isArray(raw) ? raw : []) {
		const entry = (item ?? {}) as Record<string, unknown>;
		const mode = MODES.includes(entry.mode as Mode)
			? (entry.mode as Mode)
			: "must";
		const off = entry.off === "user" ? ("user" as const) : undefined;
		const condition =
			entry.about === "experience"
				? experienceOf(entry, mode)
				: entry.about === "person" && isPersonMode(mode)
					? personOf(entry, mode)
					: null;
		if (!condition) continue;
		const key = conditionKey(condition);
		if (seen.has(key)) continue;
		seen.add(key);
		list.push(off ? { ...condition, off } : condition);
		if (list.length === CONDITION_MAX) break;
	}
	return list;
}

function experienceOf(
	entry: Record<string, unknown>,
	mode: Mode,
): ExperienceCondition | null {
	const what = some(whatOf(entry.what));
	const company = some(textList(entry.company));
	const department = some(textList(entry.department));
	const companyTag = some(dimList("companyTag", entry.companyTag));
	const kind = DIMENSIONS.kind.parse(entry.kind);
	const minMonths = DIMENSIONS.minMonths.parse(entry.minMonths);
	if (!what && !company && !department && !companyTag && !kind && !minMonths)
		return null;
	// 公司和公司档只在入职前经历上，部门只在公司内任职上：一段经历不能两样都是
	const external = Boolean(company || companyTag) || kind === "external";
	const internal = Boolean(department) || kind === "internal";
	if (external && internal) return null;
	return {
		about: "experience",
		mode,
		...(what && { what }),
		...(company && { company }),
		...(department && { department }),
		...(companyTag && { companyTag }),
		...(kind && { kind }),
		...(minMonths && { minMonths }),
	};
}

function isPersonMode(mode: Mode): mode is PersonMode {
	return (PERSON_MODES as readonly Mode[]).includes(mode);
}

function personOf(
	entry: Record<string, unknown>,
	mode: PersonMode,
): PersonCondition | null {
	const field = String(entry.field) as PersonField;
	if (!(PERSON_FIELDS as readonly string[]).includes(field)) return null;
	// 有高低的维写了 atLeast 就是「某档及以上」，同时写的 values 不读
	if (isOrdinal(field) && entry.atLeast !== undefined) {
		const [atLeast] = dimList(field, [entry.atLeast]);
		return atLeast ? { about: "person", mode, field, atLeast } : null;
	}
	const values = some(
		isPersonDim(field) ? dimList(field, entry.values) : textList(entry.values),
	);
	return values ? { about: "person", mode, field, values } : null;
}

/**
 * 条件的身份：它说的是什么、多强。停用与否不算——那是同一条条件的两种状态。
 * 按键名排序后再序列化：从库里 jsonb 读回来的条件键序和刚校验出来的不一样，
 * 身份不能跟着键序变。取值的先后算数（`what[0]` 是代表词）。
 */
export function conditionKey(condition: Condition): string {
	const { off: _off, ...rest } = condition;
	return JSON.stringify(
		Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
	);
}
