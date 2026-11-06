/**
 * 可执行的查询：一组条件，每条内部用 SQL 自由组合数据目录（`catalog.ts`）里的数据，外部形状固定。
 *
 * 模型写的是每条条件的 `where`；FROM、输出列、去重、排除的先后、累计和打分都在执行外壳里
 * （`execute.ts`），模型碰不到。一条条件按 `from`、`terms` 和 `mode` 分成四种角色：
 *
 * | from       | terms | mode          | 角色                     | 产出                   |
 * | ---------- | ----- | ------------- | ------------------------ | ---------------------- |
 * | experience | 有    | must / boost  | 经历主张                 | 事实行，进名次和证据   |
 * | experience | 无    | must / boost  | 背景（待过哪、待了多久） | 合格段，只定去留或加分 |
 * | experience | 有或无 | exclude      | 排除                     | 被否决的段             |
 * | person     | 无    | must / boost  | 人的条件                 | 人的集合               |
 *
 * 一条之内是同一段经历（同一行 `e`），条件之间是同一个人。修饰语写进同一条的 `where`
 * 还是分成两条，由模型读句子时判断，HR 看标签核对。
 */

import { CONDITION_MAX, termOf, VALUES_MAX } from "./condition";
import { MODE_NAME } from "./condition-label";
import { boundedText } from "./text";

/** 一条条件的强度：必须、加分、排除。排除只用于经历。 */
export const QUERY_MODES = ["must", "boost", "exclude"] as const;
type QueryMode = (typeof QUERY_MODES)[number];

/** 按意思找的词：键是 `hit.term` 的取值，值是同一件事的几种写法，任一命中即可。 */
type Terms = Record<string, string[]>;

export type QueryCondition = {
	/** 稳定身份：沿用的条件带原 id，新写的由服务端发 */
	id: string;
	/** 写给 HR 的一句话：这条在找什么。不当作已验证的解释 */
	label: string;
	mode: QueryMode;
	/** 只有用户能停用 */
	off?: "user";
	from: "experience" | "person";
	/** 只有经历条件可写 */
	terms?: Terms;
	/** SQL 布尔表达式。别名固定：经历的段是 `e`、命中是 `h`；人是 `p` */
	where: string;
	/** `where` 里 `:name` 引用的绑定参数 */
	params?: Record<string, string | number>;
	/** 只有经历的必须与加分：合格段累计至少多少个月，外壳在去重后按人算 */
	minMonths?: number;
};

export type Query = { conditions: QueryCondition[] };

/** 说了做过什么的经历主张：它决定名次，也是卡片上的一行证据。 */
export type Claim = QueryCondition & {
	from: "experience";
	mode: "must" | "boost";
	terms: Terms;
};

/** 只定去留或加分的条件：人的条件和背景。背景说的是待过哪、待了多久，不是做得多深。 */
export type Gate = QueryCondition & { mode: "must" | "boost" };

/** 启用的条件按执行角色拆开；下标仍指向 `query.conditions`。 */
export type Roles = {
	claims: Claim[];
	/** 必须满足的门槛：人的条件与背景 */
	gates: Gate[];
	/** 加分的门槛：满足一条乘一份固定的加分 */
	prefer: Gate[];
	excludes: QueryCondition[];
};

export function hasTerms(c: QueryCondition): c is QueryCondition & {
	terms: Terms;
} {
	return Boolean(c.terms && Object.values(c.terms).some((v) => v.length > 0));
}

export function isClaim(c: QueryCondition): c is Claim {
	return c.from === "experience" && c.mode !== "exclude" && hasTerms(c);
}

function activeOf(query: Query): QueryCondition[] {
	return query.conditions.filter((c) => !c.off);
}

export function rolesOf(query: Query): Roles {
	const roles: Roles = { claims: [], gates: [], prefer: [], excludes: [] };
	for (const c of activeOf(query)) {
		if (c.mode === "exclude") roles.excludes.push(c);
		else if (isClaim(c)) roles.claims.push(c);
		else if (c.mode === "must") roles.gates.push(c as Gate);
		else roles.prefer.push(c as Gate);
	}
	return roles;
}

/** 一条条件的全部语义词，按 `terms` 的先后摊平；证据行上的「命中的是哪个词」指向这里的下标。 */
export function termValues(c: QueryCondition): string[] {
	return Object.values(c.terms ?? {}).flat();
}

/** 一条主张在证据行上的名字：第一个语义词。证据行那一列窄，放不下整句。 */
export function claimName(claim: Claim): string {
	return termValues(claim)[0] ?? claim.label;
}

/** 一条 `where` 最长几个字。写得出一条条件的 SQL 用不到这么长。 */
export const WHERE_MAX = 2_000;

/** 一条条件最多几个语义词名、几个参数。 */
const TERM_KEYS_MAX = 4;
const PARAMS_MAX = 12;

/** 累计月数的上限：五十年。超过的不是一个时长。 */
const MONTHS_MAX = 600;

/** 条件 id、语义词名和参数名的写法。 */
const ID = /^[\w-]{1,64}$/;
const NAME = /^[a-z_][a-z0-9_]{0,23}$/i;

/** 校验过、还没定下身份的一条条件：模型新写的没有 id，由服务端发（`withIds`）。 */
export type DraftCondition = Omit<QueryCondition, "id"> & { id?: string };

function termsOf(raw: unknown): Terms | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const out: Terms = {};
	for (const [key, list] of Object.entries(raw)) {
		if (!NAME.test(key)) continue;
		const values: string[] = [];
		for (const item of Array.isArray(list) ? list : []) {
			const value = termOf(item);
			if (value && !values.includes(value)) values.push(value);
			if (values.length === VALUES_MAX) break;
		}
		if (values.length > 0) out[key] = values;
		if (Object.keys(out).length === TERM_KEYS_MAX) break;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function paramsOf(raw: unknown): QueryCondition["params"] {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const out: Record<string, string | number> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (!NAME.test(key)) continue;
		if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
		else if (typeof value === "string" && value.length <= 200) out[key] = value;
		if (Object.keys(out).length === PARAMS_MAX) break;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 一条不可信的条件 → 形状合规的条件，或 null。只查形状和角色约束：排除只用于经历、
 * 语义词只写在经历上、累计时长只在经历的必须与加分上。`where` 合不合白名单要连解析器，
 * 在服务端查（`server/sandbox.ts`）；这里只限长度，不改写字面。
 */
function draftOf(raw: unknown): DraftCondition | null {
	const entry = (raw ?? {}) as Record<string, unknown>;
	const label = boundedText(entry.label);
	const mode = QUERY_MODES.find((m) => m === entry.mode);
	const from =
		entry.from === "experience" || entry.from === "person" ? entry.from : null;
	const where = typeof entry.where === "string" ? entry.where.trim() : "";
	if (!label || !mode || !from || !where || where.length > WHERE_MAX)
		return null;
	if (from === "person" && mode === "exclude") return null;
	const id =
		typeof entry.id === "string" && ID.test(entry.id) ? entry.id : null;
	const terms = from === "experience" ? termsOf(entry.terms) : undefined;
	const params = paramsOf(entry.params);
	const months =
		from === "experience" && mode !== "exclude" ? entry.minMonths : undefined;
	const minMonths =
		typeof months === "number" &&
		Number.isInteger(months) &&
		months > 0 &&
		months <= MONTHS_MAX
			? months
			: undefined;
	return {
		...(id && { id }),
		label,
		mode,
		...(entry.off === "user" && { off: "user" as const }),
		from,
		...(terms && { terms }),
		where,
		...(params && { params }),
		...(minMonths && { minMonths }),
	};
}

/** 一列不可信的条件 → 形状合规的条件，最多 `CONDITION_MAX` 条；同一个 id 只认第一次。 */
export function draftsOf(raw: unknown): DraftCondition[] {
	const out: DraftCondition[] = [];
	const ids = new Set<string>();
	for (const item of Array.isArray(raw) ? raw : []) {
		const draft = draftOf(item);
		if (!draft) continue;
		if (draft.id && ids.has(draft.id)) delete draft.id;
		if (draft.id) ids.add(draft.id);
		out.push(draft);
		if (out.length === CONDITION_MAX) break;
	}
	return out;
}

/** 新条件的 id：八位随机串，浏览器和服务端都能发。 */
export function newConditionId(): string {
	return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

/** 没有 id 的发一个新的。 */
export function withIds(drafts: readonly DraftCondition[]): QueryCondition[] {
	return drafts.map((d) => ({ ...d, id: d.id ?? newConditionId() }));
}

function sorted<T>(record: Record<string, T> | undefined) {
	return record
		? Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		: null;
}

/**
 * 一条条件说的是什么：强度、FROM、语义词、`where`、参数、累计时长。不含 id、标签和停用：
 * 同一个 id 内容变了算改了一条；标签只是写给 HR 的话，停用不是改。
 */
export function contentKey(c: DraftCondition): string {
	return JSON.stringify([
		c.mode,
		c.from,
		sorted(c.terms),
		c.where,
		sorted(c.params),
		c.minMonths ?? null,
	]);
}

/** 停用或启用一条条件，别的原样。 */
export function withOff<C extends DraftCondition>(c: C, off: "user" | null): C {
	const { off: _off, ...rest } = c;
	return (off ? { ...rest, off } : rest) as C;
}

/** 一组条件写进一句话：标签和强度，和 chip 上跟在标签后的是同一个说法。 */
export function labelsInSentence(
	conditions: readonly QueryCondition[],
): string {
	return conditions
		.map((c) =>
			c.mode === "must" ? c.label : `${c.label}（${MODE_NAME[c.mode]}）`,
		)
		.join("、");
}
