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

/** 一条条件的强度：必须、加分、排除。排除只用于经历。 */
type QueryMode = "must" | "boost" | "exclude";

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
