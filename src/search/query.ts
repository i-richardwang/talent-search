/**
 * 可执行的查询：一组条件，每条内部用 SQL 自由组合数据目录（`catalog.ts`）里的数据，外部形状固定。
 *
 * 模型写的是每条条件的 `where`；FROM、输出列、去重、累计和打分都在执行外壳里（`execute.ts`），
 * 模型碰不到。每条条件说的都是一个人，各读各的原始数据，谁也不改别的条件读到什么；按 `from`、
 * `seek` 和 `mode` 分成四种角色：
 *
 * | from       | seek   | mode          | 角色                       | 产出                   |
 * | ---------- | ------ | ------------- | -------------------------- | ---------------------- |
 * | experience | 有     | must / boost  | 经历主张：有这样一段经历   | 事实行，进名次和证据   |
 * | experience | 无     | must / boost  | 背景（待过哪、待了多久）   | 合格段，只定去留或加分 |
 * | experience | 有或无 | exclude       | 排除：没有任何一段这样的经历 | 人的去留             |
 * | person     | 无     | must / boost  | 人的条件                   | 人的集合               |
 *
 * 一条之内是同一段经历（同一行 `e`），条件之间是同一个人。修饰语写进同一条的 `where`
 * 还是分成两条，由模型读句子时判断，HR 看标签核对。「这种不算」是对某一条的限定，写进那一条
 * 自己的 `where` 或判据；「这个人不能有这种经历」才是排除。
 */

import { CONDITION_MAX, MODES, type Mode, sortedEntries } from "./condition";
import { MODE_NAME } from "./condition-label";
import { boundedText } from "./text";

/**
 * 做过什么：哪些段是候选，候选里哪些算。两样至少写一样。
 *
 * - `patterns`：正则，不分大小写，在全部写法上按字面匹配（`phrases.ts`）；任一条匹配就捞到。
 *   空着时 `where` 圈出的每一段都是候选：这件事按字面找不出来，只能读了才知道。
 * - `criterion`：什么样的经历算、什么不算。候选的经历由查询理解照它确认，确认过、算数的才是
 *   证据。没写判据时捞到的都算：关键词搜索搜的就是字面。
 */
export type Seek = { patterns: string[]; criterion?: string };

export type QueryCondition = {
	/** 稳定身份：沿用的条件带原 id，新写的由服务端发 */
	id: string;
	/** 写给 HR 的一句话：这条在找什么。不当作已验证的解释 */
	label: string;
	/** 强度：必须、加分、排除（`condition.ts` 的 `MODES`）。排除只用于经历：这个人没有这样的段。 */
	mode: Mode;
	/** 只有用户能停用 */
	off?: "user";
	from: "experience" | "person";
	/** 只有经历条件可写 */
	seek?: Seek;
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
	seek: Seek;
};

/** 只定去留或加分的条件：人的条件和背景。背景说的是待过哪、待了多久，不是做得多深。 */
type Gate = QueryCondition & { mode: "must" | "boost" };

/** 排除：这个人没有任何一段这样的经历。只定去留，不产出证据。 */
export type Exclusion = QueryCondition & {
	from: "experience";
	mode: "exclude";
};

/** 启用的条件各是哪种角色。 */
export type Roles = {
	claims: Claim[];
	/** 必须满足的门槛：人的条件与背景 */
	gates: Gate[];
	/** 加分的门槛：满足一条乘一份固定的加分 */
	prefer: Gate[];
	excludes: Exclusion[];
};

export function seeks(c: QueryCondition): c is QueryCondition & {
	seek: Seek;
} {
	return c.seek !== undefined;
}

export function isClaim(c: QueryCondition): c is Claim {
	return c.from === "experience" && c.mode !== "exclude" && seeks(c);
}

function activeOf(query: Query): QueryCondition[] {
	return query.conditions.filter((c) => !c.off);
}

export function rolesOf(query: Query): Roles {
	const roles: Roles = { claims: [], gates: [], prefer: [], excludes: [] };
	for (const c of activeOf(query)) {
		if (c.mode === "exclude") roles.excludes.push(c as Exclusion);
		else if (isClaim(c)) roles.claims.push(c);
		else if (c.mode === "must") roles.gates.push(c as Gate);
		else roles.prefer.push(c as Gate);
	}
	return roles;
}

/** 一条 `where` 最长几个字。写得出一条条件的 SQL 用不到这么长。 */
export const WHERE_MAX = 2_000;

/** 一条条件最多几个参数。 */
const PARAMS_MAX = 12;

/** 一条条件最多几条正则、一条正则最长几个字、判据最长几个字。 */
const PATTERNS_MAX = 24;
const PATTERN_MAX = 120;
const CRITERION_MAX = 600;

/** 累计月数的上限：五十年。超过的不是一个时长。 */
const MONTHS_MAX = 600;

/** 条件 id 和参数名的写法。 */
const ID = /^[\w-]{1,64}$/;
const NAME = /^[a-z_][a-z0-9_]{0,23}$/i;

/** 校验过、还没定下身份的一条条件：模型新写的没有 id，由服务端发（`withIds`）。 */
export type DraftCondition = Omit<QueryCondition, "id"> & { id?: string };

/**
 * 不可信的一份「做过什么」。正则只限长度和条数：写得对不对要交给数据库的正则引擎，
 * 在执行时查（`phrases.ts`）。正则和判据都没有就不是一份。
 */
function seekOf(raw: unknown): Seek | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const entry = raw as Record<string, unknown>;
	const patterns: string[] = [];
	for (const item of Array.isArray(entry.patterns) ? entry.patterns : []) {
		if (typeof item !== "string") continue;
		const pattern = item.trim();
		if (!pattern || pattern.length > PATTERN_MAX || patterns.includes(pattern))
			continue;
		patterns.push(pattern);
		if (patterns.length === PATTERNS_MAX) break;
	}
	const criterion =
		typeof entry.criterion === "string"
			? entry.criterion.trim().slice(0, CRITERION_MAX)
			: "";
	if (patterns.length === 0 && !criterion) return undefined;
	return { patterns, ...(criterion && { criterion }) };
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
 * 「做过什么」只写在经历上，显式写了但无效时整条不收；累计时长只在经历的必须与加分上。
 * `where` 合不合白名单要连解析器，在服务端查（`server/sandbox.ts`）；这里只限长度，不改写字面。
 */
function draftOf(raw: unknown): DraftCondition | null {
	const entry = (raw ?? {}) as Record<string, unknown>;
	const label = boundedText(entry.label);
	const mode = MODES.find((m) => m === entry.mode);
	const from =
		entry.from === "experience" || entry.from === "person" ? entry.from : null;
	const where = typeof entry.where === "string" ? entry.where.trim() : "";
	if (!label || !mode || !from || !where || where.length > WHERE_MAX)
		return null;
	if (from === "person" && mode === "exclude") return null;
	const id =
		typeof entry.id === "string" && ID.test(entry.id) ? entry.id : null;
	const seek = from === "experience" ? seekOf(entry.seek) : undefined;
	if (from === "experience" && entry.seek !== undefined && !seek) return null;
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
		...(seek && { seek }),
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

/**
 * 一条条件说的是什么：强度、FROM、做过什么、`where`、参数、累计时长。不含 id、标签和停用：
 * 同一个 id 内容变了算改了一条；标签只是写给 HR 的话，停用不是改。
 */
export function contentKey(c: DraftCondition): string {
	return JSON.stringify([
		c.mode,
		c.from,
		c.seek ? [c.seek.patterns, c.seek.criterion ?? null] : null,
		c.where,
		c.params ? sortedEntries(c.params) : null,
		c.minMonths ?? null,
	]);
}

/** 一条条件的身份：id 加内容。id 相同、内容变了算另一条。 */
export function identityKey(c: QueryCondition): string {
	return `${c.id}\u0001${contentKey(c)}`;
}

/** 停用或启用一条条件，别的原样。 */
export function withOff<C extends DraftCondition>(c: C, off: "user" | null): C {
	const { off: _off, ...rest } = c;
	return (off ? { ...rest, off } : rest) as C;
}

/** 一组条件写进一句话：标签和强度，和 chip 上跟在标签后的是同一个说法。 */
export function labelsInSentence(
	conditions: readonly Pick<QueryCondition, "label" | "mode">[],
): string {
	return conditions
		.map((c) =>
			c.mode === "must" ? c.label : `${c.label}（${MODE_NAME[c.mode]}）`,
		)
		.join("、");
}
