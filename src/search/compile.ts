/**
 * 关键词链的条件表（`condition.ts` 的 `Condition[]`）编译成可执行的查询（`query.ts`）。
 * 关键词框存的就是它能写回框里的那种条件表（`keywords.ts`）；这种形状的记录读取时经这里
 * 编译，显示和执行都用编译出的查询。模板固定：每一项落到目录列上的一个谓词，名字走
 * `escapeLike` 后作绑定参数，取值和词都不改写。
 *
 * - 经历主张：经历词是 `terms`，在哪、哪一档、入职前还是公司内写进 `where`，累计时长是 `minMonths`。
 * - 背景（没写经历词的经历主张）：同上，没有 `terms`。
 * - 排除：时长按单段判，写进 `where`（`e.months >= :months`），否决问的是「这一段是不是 X」。
 * - 人的条件：词表维按档名，「某档及以上」按档高，学校按名字包含。
 *
 * 身份由条件的 `conditionKey` 散列而来：同一张表每次编译出同样的 id，停用状态和一轮前后
 * 的差别按条件比。
 */
import { ORDINAL_STREAM } from "#/db/schema";
import { escapeLike } from "#/lib/sql";
import { rankOf } from "./catalog";
import {
	type Condition,
	conditionKey,
	type ExperienceCondition,
} from "./condition";
import { conditionLabel } from "./condition-label";
import type { Query, QueryCondition } from "./query";

/** 经历主张的 `what` 在 `terms` 里的键。 */
const WHAT_KEY = "what";

/** 人的条件里词表维对应的 `person` 列。 */
const PERSON_COLUMN = {
	level: "level_band",
	education: "education",
	recruitment: "recruitment",
	schoolTier: "school_tier",
	overseas: "overseas",
} as const;

type Built = { where: string; params: Record<string, string | number> };

/** 谓词逐条拼起来；参数名按出现顺序编号，同一条条件里不会撞名。 */
class Where {
	private readonly parts: string[] = [];
	readonly params: Record<string, string | number> = {};
	private next = 0;

	param(value: string | number): string {
		const name = `v${this.next++}`;
		this.params[name] = value;
		return `:${name}`;
	}

	add(part: string) {
		this.parts.push(part);
	}

	/** 这几列里任一列含这几个名字里任一个。 */
	anyLike(columns: readonly string[], names: readonly string[]) {
		const each = names.flatMap((name) => {
			const pattern = this.param(`%${escapeLike(name)}%`);
			return columns.map((column) => `${column} ilike ${pattern}`);
		});
		this.add(`(${each.join(" or ")})`);
	}

	inList(column: string, values: readonly string[]) {
		this.add(`${column} in (${values.map((v) => this.param(v)).join(", ")})`);
	}

	built(): Built {
		return {
			where: this.parts.length > 0 ? this.parts.join(" and ") : "true",
			params: this.params,
		};
	}
}

function segment(c: ExperienceCondition): Where {
	const w = new Where();
	if (c.kind) w.add(`e.kind = ${w.param(c.kind)}`);
	if (c.company) w.anyLike(["e.company"], c.company);
	if (c.department)
		w.anyLike(["e.department", "e.department_path"], c.department);
	if (c.companyTag) w.inList("e.company_tag", c.companyTag);
	if (c.mode === "exclude" && c.minMonths)
		w.add(`e.months >= ${w.param(c.minMonths)}`);
	return w;
}

function person(c: Extract<Condition, { about: "person" }>): Where {
	const w = new Where();
	if ("atLeast" in c) {
		// 档高查档位表，和目录、提示词教模型的写法是同一句
		const column = PERSON_COLUMN[c.field];
		const rank = rankOf("person", column);
		if (!rank) throw new Error(`目录里 person.${column} 没有档高列`);
		w.add(
			`p.${rank} >= (select s.rank from scale s where s.stream = '${ORDINAL_STREAM[c.field]}' and s.value = ${w.param(c.atLeast)})`,
		);
	} else if (c.field === "school") w.anyLike(["p.school"], c.values);
	else w.inList(`p.${PERSON_COLUMN[c.field]}`, c.values);
	return w;
}

/** 32 位 FNV-1a，两个起点各算一遍拼成 16 位十六进制：只用来给条件一个短而稳定的 id。 */
function fnv(text: string, seed: number): string {
	let h = seed;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

function conditionId(c: Condition): string {
	const key = conditionKey(c);
	return `c${fnv(key, 0x811c9dc5)}${fnv(key, 0x01234567)}`;
}

/** 一条关键词链的条件 → 一条查询条件。 */
export function compileCondition(c: Condition): QueryCondition {
	const base = {
		id: conditionId(c),
		label: conditionLabel(c),
		mode: c.mode,
		...(c.off && { off: c.off }),
	};
	if (c.about === "person")
		return { ...base, from: "person", ...trimmed(person(c).built()) };
	return {
		...base,
		from: "experience",
		...(c.what && { terms: { [WHAT_KEY]: [...c.what] } }),
		...trimmed(segment(c).built()),
		...(c.mode !== "exclude" && c.minMonths && { minMonths: c.minMonths }),
	};
}

function trimmed({ where, params }: Built) {
	return Object.keys(params).length > 0 ? { where, params } : { where };
}

export function compileConditions(conditions: readonly Condition[]): Query {
	return { conditions: conditions.map(compileCondition) };
}
