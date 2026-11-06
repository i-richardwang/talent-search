/**
 * 旧条件表（`condition.ts` 的 `Condition[]`）编译成可执行的查询（`query.ts`）。关键词框
 * 存的就是它能写回框里的那种条件表（`keywords.ts`），经同一条路编译。模板固定：每一项
 * 落到目录列上的一个谓词，名字走 `escapeLike` 后作绑定参数，取值和词都不改写。旧记录
 * 不迁数据，读取时经这里编译，显示和执行照常。
 *
 * - 经历主张：经历词是 `terms`，在哪、哪一档、入职前还是公司内写进 `where`，累计时长是 `minMonths`。
 * - 背景（没写经历词的经历主张）：同上，没有 `terms`。
 * - 排除：时长按单段判，写进 `where`（`e.months >= :months`），否决问的是「这一段是不是 X」。
 * - 人的条件：词表维按档名，「某档及以上」按档高，学校按名字包含。
 *
 * 身份是旧条件的 `conditionKey`：同一份旧表每次编译出同样的 id。
 */
import { escapeLike } from "#/lib/sql";
import {
	type Condition,
	conditionKey,
	type ExperienceCondition,
} from "./condition";
import { conditionLabel } from "./condition-label";
import type { OrdinalKey } from "./dimensions";
import type { Query, QueryCondition } from "./query";

/** 旧经历主张的经历词在 `terms` 里的键。 */
const LEGACY_TERM = "what";

/** 人的条件里词表维对应的目录列。 */
const PERSON_COLUMN = {
	level: "p.level_band",
	education: "p.education",
	recruitment: "p.recruitment",
	schoolTier: "p.school_tier",
	overseas: "p.overseas",
} as const;

const RANK_COLUMN: Record<OrdinalKey, string> = {
	level: "p.level_rank",
	education: "p.education_rank",
};

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
		const rank = RANK_COLUMN[c.field];
		const band = PERSON_COLUMN[c.field];
		// 档高当场从库里查：同一档的人档高相同（同步时校验过），取哪一个都一样
		w.add(
			`${rank} >= (select min(x.${rank.slice(2)}) from person x where x.${band.slice(2)} = ${w.param(c.atLeast)})`,
		);
	} else if (c.field === "school") w.anyLike(["p.school"], c.values);
	else w.inList(PERSON_COLUMN[c.field], c.values);
	return w;
}

/** 一条旧条件 → 一条查询条件。 */
export function compileCondition(c: Condition): QueryCondition {
	const base = {
		id: conditionKey(c),
		label: conditionLabel(c),
		mode: c.mode,
		...(c.off && { off: c.off }),
	};
	if (c.about === "person")
		return { ...base, from: "person", ...trimmed(person(c).built()) };
	return {
		...base,
		from: "experience",
		...(c.what && { terms: { [LEGACY_TERM]: [...c.what] } }),
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
