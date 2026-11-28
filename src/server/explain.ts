/**
 * 一条条件实际要什么，排成 HR 读得懂的样子：工作内容（判据），经历范围（满足其中一种即可，
 * 每一种是几行「属性 取值」，都要满足），累计时长。范围从真正执行的那份 `where` 的语法树翻出来，不让模型
 * 另写一遍：名称是模型写的，可能和它写的 `where` 对不上，HR 要能看出来。
 *
 * 「且」「或」统一展开成「几种之一、每种都要」（析取范式），HR 只读一种结构；展开后种数太多时，
 * 多出来的那层「或」留在一行里，写成「符合下面任一种」。列的名字和代码的说法来自数据目录
 * （`search/catalog.ts`），记录流的名字来自 `record_stream`。翻不出来的部分写一行
 * 「这里说不清楚」，不猜、不露出 SQL。
 */
import "@tanstack/react-start/server-only";
import { db } from "#/db";
import { ORDINAL_STREAM, recordStream } from "#/db/schema";
import { CATALOG, type CatalogRelation, HIT } from "#/search/catalog";
import { DIMENSIONS } from "#/search/dimensions";
import type { QueryCondition } from "#/search/query";
import { queryOfSpec } from "#/search/spec";
import { whereTree } from "./sandbox";
import type { Turn } from "./turn";

/** 取值里的一段：人才库里的取值（`tag`）或连接它们的字（`word`）。 */
export type Piece = { tag: string } | { word: string };

/** 一种里的一行。 */
export type Row =
	| { kind: "fact"; field: string; value: Piece[] }
	| { kind: "unclear" }
	/** 一组自己的要求：一条子记录（「至少 2 期绩效」）、「并非」或展开不下的那层「或」 */
	| { kind: "nested"; head: string; options: Option[] };

/** 一种：`lead` 是这一种经历的来源（外部经历、公司内经历），各行都要满足。 */
export type Option = { lead: string | null; rows: Row[] };

/** 工作内容：判据原文，或没写判据时简历里要写到的字（写到其中一个就算：甲 / 乙）。 */
export type Work = { criterion: string } | { written: Piece[] };

export type ConditionExplained = {
	/** 没写做过什么的条件（背景、人的条件）没有 */
	work: Work | null;
	/** 满足其中一种即可；什么都不限时是空的 */
	options: Option[];
	/** 这样的经历加起来至少多少个月 */
	months: number | null;
};

/** 线程上的一轮，带着每条条件的说明（按条件 id）；条件还没理解出来时是空的。 */
export type ThreadTurn = Turn & {
	explained: Record<string, ConditionExplained>;
};

/** 记录流和档位表的 `stream` 代码 → 名字。 */
type StreamNames = ReadonlyMap<string, string>;

/** 展开成几种之一时最多几种；再多就把那层「或」留在一行里。 */
const OPTIONS_MAX = 6;

/** 子查询里的一行叫一「什么」：至少 2 期绩效、有一段工作经历。 */
const UNIT: Record<string, string> = {
	experience: "段",
	rating: "期",
	status: "段",
};

/** 经历的来源那一列：它是一种经历的抬头，不是一行。 */
const LEAD_COLUMN = { relation: "experience", column: "kind" };

const RELATIONS = new Map<string, CatalogRelation>(
	[...CATALOG, HIT].map((r) => [r.name, r]),
);

type AnyNode = Record<string, unknown>;
type Value = string | number | boolean;

type Ctx = {
	/** 别名 → 关系，外层在前 */
	scopes: Map<string, CatalogRelation>[];
	params: Readonly<Record<string, Value>>;
	order: readonly string[];
	streams: StreamNames;
};

type Col = { rel: CatalogRelation; name: string };

/** 一行「属性 取值」；来源那一列的取值是 `lead`，展开后成为那一种的抬头。 */
type Fact = { t: "fact"; field: string; value: Piece[]; lead?: string };

/** 翻译的中间形状：还没展开的「且」「或」。 */
type Expr =
	| Fact
	| { t: "unclear" }
	| { t: "and" | "or"; items: Expr[] }
	| { t: "nested"; head: string; inner: Expr | null }
	/** 关联两个关系的等式：只说明哪几行连在一起，对 HR 没有内容 */
	| { t: "skip" };

const UNCLEAR: Expr = { t: "unclear" };
const SKIP: Expr = { t: "skip" };

const tag = (v: Value): Piece => ({ tag: String(v) });
const word = (w: string): Piece => ({ word: w });

function unwrap(node: unknown): [string, AnyNode] {
	const entries = Object.entries((node ?? {}) as AnyNode);
	const [entry] = entries;
	return entry ? [entry[0], (entry[1] ?? {}) as AnyNode] : ["", {}];
}

function names(list: unknown): string[] {
	return (Array.isArray(list) ? list : []).map(
		(n) => (n as { String?: { sval?: string } }).String?.sval ?? "",
	);
}

function columnOf(node: unknown, ctx: Ctx): Col | null {
	const [type, body] = unwrap(node);
	if (type !== "ColumnRef") return null;
	const parts = names(body.fields);
	const name = parts.at(-1) ?? "";
	if (parts.length === 2) {
		for (let i = ctx.scopes.length - 1; i >= 0; i--) {
			const rel = ctx.scopes[i]?.get(parts[0] ?? "");
			if (rel) return Object.hasOwn(rel.columns, name) ? { rel, name } : null;
		}
		return null;
	}
	const inner = [...(ctx.scopes.at(-1)?.values() ?? [])];
	const rel = inner.find((r) => Object.hasOwn(r.columns, name));
	return rel ? { rel, name } : null;
}

const declOf = (c: Col) => c.rel.columns[c.name];
/** 一列给 HR 看的名字：是筛选里的一维就用那一维的名字，各处叫法一致。 */
function labelOf(c: Col): string {
	const decl = declOf(c);
	if (!decl) return c.name;
	return decl.dimension ? DIMENSIONS[decl.dimension].label : decl.label;
}
const isLead = (c: Col) =>
	c.rel.name === LEAD_COLUMN.relation && c.name === LEAD_COLUMN.column;

/** 档高列（`level_rank`）说的是哪一列（职级档）。 */
function ordinalOf(c: Col): Col | null {
	for (const [name, decl] of Object.entries(c.rel.columns))
		if (decl.values === "ordinal" && decl.rank === c.name)
			return { rel: c.rel, name };
	return null;
}

function constOf(node: unknown, ctx: Ctx): Value | null {
	const [type, body] = unwrap(node);
	if (type === "A_Const") {
		if (body.isnull) return null;
		if ("sval" in body) return String((body.sval as AnyNode).sval ?? "");
		if ("ival" in body) return Number((body.ival as AnyNode).ival ?? 0);
		if ("fval" in body) return Number((body.fval as AnyNode).fval);
		if ("boolval" in body) return Boolean((body.boolval as AnyNode).boolval);
		return null;
	}
	if (type === "ParamRef") {
		const name = ctx.order[Number(body.number) - 1];
		return name === undefined ? null : (ctx.params[name] ?? null);
	}
	if (type === "TypeCast") return constOf(body.arg, ctx);
	return null;
}

/** 一个取值对 HR 怎么说：代码换成它的说法，记录流换成名字。 */
function valueName(v: Value, col: Col | null, ctx: Ctx): string {
	if (typeof v === "string" && col) {
		const says = declOf(col)?.says?.[v];
		if (says) return says;
		if (col.name === "stream") return ctx.streams.get(v) ?? v;
	}
	return String(v);
}

const INTERVAL_UNITS: [RegExp, string][] = [
	[/^(years?|y)$/, "年"],
	[/^(mons?|months?)$/, "个月"],
	[/^(weeks?|w)$/, "周"],
	[/^(days?|d)$/, "天"],
];

function intervalText(text: string): string | null {
	const m = /^\s*(\d+)\s*([a-z]+)\s*$/i.exec(text);
	if (!m) return null;
	const unit = INTERVAL_UNITS.find(([re]) =>
		re.test(m[2]?.toLowerCase() ?? ""),
	);
	return unit ? `${m[1]} ${unit[1]}` : null;
}

/** 比较里不是列的那一边：人才库里的取值是 tag，今天、几年前这类算出来的是字。 */
function termOf(node: unknown, ctx: Ctx, col: Col | null): Piece[] | null {
	const [type, body] = unwrap(node);
	if (type === "SQLValueFunction") return [word("今天")];
	if (type === "TypeCast") {
		const target = names((body.typeName as AnyNode)?.names).at(-1);
		const v = constOf(body.arg, ctx);
		if (target === "interval" && typeof v === "string") {
			const text = intervalText(v);
			return text ? [word(text)] : null;
		}
		return v === null
			? termOf(body.arg, ctx, col)
			: [tag(valueName(v, col, ctx))];
	}
	if (type === "A_Expr" && body.kind === "AEXPR_OP") {
		const op = names(body.name)[0];
		const left = termOf(body.lexpr, ctx, null);
		const right = termOf(body.rexpr, ctx, null);
		const first = left?.length === 1 ? left[0] : undefined;
		const today =
			first !== undefined && "word" in first && first.word === "今天";
		const amount =
			right?.length === 1 && right[0] && "word" in right[0]
				? right[0].word
				: null;
		if (today && amount && (op === "-" || op === "+"))
			return [word(`${amount}${op === "-" ? "前" : "后"}`)];
		return null;
	}
	if (type === "A_ArrayExpr") {
		const items = (Array.isArray(body.elements) ? body.elements : []).map((e) =>
			constOf(e, ctx),
		);
		if (items.some((i) => i === null)) return null;
		return either((items as Value[]).map((v) => tag(valueName(v, col, ctx))));
	}
	const v = constOf(node, ctx);
	return v === null ? null : [tag(valueName(v, col, ctx))];
}

/** 几个取值，任一即可：甲 / 乙。 */
function either(pieces: Piece[]): Piece[] {
	return pieces.flatMap((p, i) => (i === 0 ? [p] : [word("/"), p]));
}

/** `ilike` 的模式：两头的 % 说成「含」「开头」「结尾」，别的照写。 */
function likeOf(pattern: string, negated: boolean): Piece[] {
	const inner = pattern.replace(/^%+/, "").replace(/%+$/, "");
	const no = negated ? "不" : "";
	if (/[%_\\]/.test(inner)) return [word(`${no}符合`), tag(pattern)];
	const start = pattern.startsWith("%");
	const end = pattern.endsWith("%");
	if (start && end) return [word(`${no}含`), tag(inner)];
	if (end) return [word(`${no}以`), tag(inner), word("开头")];
	if (start) return [word(`${no}以`), tag(inner), word("结尾")];
	return negated ? [word("不是"), tag(inner)] : [tag(inner)];
}

const FLIP: Record<string, string> = {
	"<": ">",
	">": "<",
	"<=": ">=",
	">=": "<=",
};

/** 数量和日期的比较怎么说。 */
const AMOUNT: Record<string, string> = {
	">=": "至少",
	">": "多于",
	"<=": "至多",
	"<": "少于",
};
const DATE: Record<string, string> = {
	">=": "不早于",
	">": "晚于",
	"<=": "不晚于",
	"<": "早于",
};

function fact(col: Col, value: Piece[]): Expr {
	if (isLead(col) && value.length === 1 && value[0] && "tag" in value[0])
		return { t: "fact", field: labelOf(col), value, lead: value[0].tag };
	return { t: "fact", field: labelOf(col), value };
}

function compare(col: Col, op: string, value: Piece[]): Expr {
	if (op === "=") return fact(col, value);
	if (op === "<>" || op === "!=") return fact(col, [word("不是"), ...value]);
	const w = (declOf(col)?.type === "date" ? DATE : AMOUNT)[op];
	return w ? fact(col, [word(w), ...value]) : UNCLEAR;
}

/** 档位表里查一档：`(select s.rank from scale s where … s.value = 'A')` → A。 */
function scaleValue(node: unknown, ctx: Ctx): string | null {
	const [type, body] = unwrap(node);
	if (type !== "SubLink" || body.subLinkType !== "EXPR_SUBLINK") return null;
	const select = unwrap(body.subselect)[1];
	const from = Array.isArray(select.fromClause) ? select.fromClause : [];
	const [rv, rvBody] = unwrap(from[0]);
	if (from.length !== 1 || rv !== "RangeVar" || rvBody.relname !== "scale")
		return null;
	let found: string | null = null;
	const visit = (n: unknown) => {
		const [t, b] = unwrap(n);
		if (t === "BoolExpr" && b.boolop === "AND_EXPR")
			for (const a of b.args as unknown[]) visit(a);
		if (t === "A_Expr" && b.kind === "AEXPR_OP" && names(b.name)[0] === "=") {
			for (const [colSide, valSide] of [
				[b.lexpr, b.rexpr],
				[b.rexpr, b.lexpr],
			]) {
				const c = unwrap(colSide);
				if (c[0] !== "ColumnRef" || names(c[1].fields).at(-1) !== "value")
					continue;
				const v = constOf(valSide, ctx);
				if (v !== null) found = String(v);
			}
		}
	};
	visit(select.whereClause);
	return found;
}

/** 子查询的关系、记录流（写进这组的抬头）和它自己的要求。只认 FROM 一个目录里的关系。 */
function subquery(
	select: AnyNode,
	ctx: Ctx,
): { rel: CatalogRelation; stream: string | null; inner: Expr | null } | null {
	const from = Array.isArray(select.fromClause) ? select.fromClause : [];
	const [type, body] = unwrap(from[0]);
	if (from.length !== 1 || type !== "RangeVar") return null;
	const rel = RELATIONS.get(String(body.relname));
	if (!rel) return null;
	const alias =
		((body.alias as AnyNode | undefined)?.aliasname as string | undefined) ??
		rel.name;
	const inner: Ctx = {
		...ctx,
		scopes: [...ctx.scopes, new Map([[alias, rel]])],
	};
	let stream: string | null = null;
	const items: Expr[] = [];
	for (const p of conjuncts(select.whereClause)) {
		const [t, b] = unwrap(p);
		if (t === "A_Expr" && b.kind === "AEXPR_OP" && names(b.name)[0] === "=") {
			const col = columnOf(b.lexpr, inner);
			const v = constOf(b.rexpr, inner);
			if (col?.name === "stream" && col.rel === rel && typeof v === "string") {
				stream = ctx.streams.get(v) ?? v;
				continue;
			}
		}
		items.push(translate(p, inner));
	}
	const all = and(items);
	return { rel, stream, inner: all.t === "skip" ? null : all };
}

function conjuncts(node: unknown): unknown[] {
	if (!node) return [];
	const [t, b] = unwrap(node);
	return t === "BoolExpr" && b.boolop === "AND_EXPR"
		? (b.args as unknown[]).flatMap(conjuncts)
		: [node];
}

function countHead(
	op: string,
	n: number,
	rel: CatalogRelation,
	stream: string | null,
): string | null {
	const unit = UNIT[rel.name] ?? "条";
	const what = stream ?? rel.label;
	if ((op === "=" && n === 0) || (op === "<" && n === 1))
		return `没有一${unit}${what}这样`;
	const w = op === "=" ? "恰好" : AMOUNT[op];
	return w ? `${w} ${n} ${unit}${what}这样` : null;
}

function comparison(body: AnyNode, ctx: Ctx): Expr {
	let op = names(body.name)[0] ?? "";
	let left = body.lexpr;
	let right = body.rexpr;
	const lc = columnOf(left, ctx);
	const rc = columnOf(right, ctx);
	if (op === "=" && lc && rc) return SKIP;

	// 数一数有几条：(select count(*) from rating r where …) >= 2
	for (const [subSide, numSide, o] of [
		[left, right, op],
		[right, left, FLIP[op] ?? op],
	] as const) {
		const [t, b] = unwrap(subSide);
		if (t !== "SubLink" || b.subLinkType !== "EXPR_SUBLINK") continue;
		const select = unwrap(b.subselect)[1];
		const target = unwrap(
			(unwrap((select.targetList as unknown[])?.[0])[1] as AnyNode).val,
		);
		if (
			target[0] !== "FuncCall" ||
			names(target[1].funcname).at(-1) !== "count"
		)
			continue;
		const n = constOf(numSide, ctx);
		const sub = subquery(select, ctx);
		if (!sub || typeof n !== "number") return UNCLEAR;
		const head = countHead(o, n, sub.rel, sub.stream);
		return head ? { t: "nested", head, inner: sub.inner } : UNCLEAR;
	}

	if (!lc && rc) {
		[left, right] = [right, left];
		op = FLIP[op] ?? op;
	}
	const col = columnOf(left, ctx);
	if (!col) return UNCLEAR;

	// 比档高：职级档 P7 及以上
	const ordinal = ordinalOf(col);
	const band = scaleValue(right, ctx);
	if (ordinal && band) {
		const w: Record<string, Piece[]> = {
			">=": [tag(band), word("及以上")],
			">": [word("高于"), tag(band)],
			"<=": [tag(band), word("及以下")],
			"<": [word("低于"), tag(band)],
			"=": [tag(band)],
		};
		const pieces = w[op];
		return pieces ? fact(ordinal, pieces) : UNCLEAR;
	}

	if (op === "~~*" || op === "~~" || op === "!~~*" || op === "!~~") {
		const v = constOf(right, ctx);
		return typeof v === "string"
			? fact(col, likeOf(v, op.startsWith("!")))
			: UNCLEAR;
	}
	if (op === "~" || op === "~*" || op === "!~" || op === "!~*") {
		const v = constOf(right, ctx);
		return typeof v === "string"
			? fact(col, [word(op.startsWith("!") ? "不符合" : "符合"), tag(v)])
			: UNCLEAR;
	}
	if (op === "&&" || op === "@>") {
		const v = termOf(right, ctx, col);
		return v
			? fact(col, [word(op === "&&" ? "含其中任一" : "全都含"), ...v])
			: UNCLEAR;
	}
	const value = termOf(right, ctx, col);
	return value ? compare(col, op, value) : UNCLEAR;
}

/** `'外卖' = any(e.main_industries)`、`e.title ilike any(array[…])`。 */
function anyAll(body: AnyNode, ctx: Ctx, all: boolean): Expr {
	const op = names(body.name)[0] ?? "";
	const arrayCol = columnOf(body.rexpr, ctx);
	if (arrayCol && declOf(arrayCol)?.type === "text[]") {
		const v = termOf(body.lexpr, ctx, arrayCol);
		if (!v) return UNCLEAR;
		if (op === "=" && !all) return fact(arrayCol, v);
		if ((op === "<>" || op === "!=") && all)
			return fact(arrayCol, [word("不含"), ...v]);
		return UNCLEAR;
	}
	const col = columnOf(body.lexpr, ctx);
	if (!col || all) return UNCLEAR;
	const [t, b] = unwrap(body.rexpr);
	const elements =
		t === "A_ArrayExpr" && Array.isArray(b.elements) ? b.elements : null;
	const values = elements?.map((e) => constOf(e, ctx));
	if (!values || values.some((v) => typeof v !== "string")) return UNCLEAR;
	if (op === "~~*" || op === "~~")
		return or((values as string[]).map((v) => fact(col, likeOf(v, false))));
	if (op === "=")
		return fact(
			col,
			either((values as string[]).map((v) => tag(valueName(v, col, ctx)))),
		);
	return UNCLEAR;
}

function translate(node: unknown, ctx: Ctx): Expr {
	const [type, body] = unwrap(node);
	switch (type) {
		case "BoolExpr": {
			const args = (Array.isArray(body.args) ? body.args : []) as unknown[];
			if (body.boolop === "NOT_EXPR") {
				const inner = translate(args[0], ctx);
				return inner.t === "skip"
					? SKIP
					: { t: "nested", head: "并非下面这样", inner };
			}
			const items = args.map((a) => translate(a, ctx));
			return body.boolop === "OR_EXPR" ? or(items) : and(items);
		}
		case "A_Expr": {
			switch (body.kind) {
				case "AEXPR_OP":
				case "AEXPR_LIKE":
				case "AEXPR_ILIKE":
					return comparison(body, ctx);
				case "AEXPR_OP_ANY":
					return anyAll(body, ctx, false);
				case "AEXPR_OP_ALL":
					return anyAll(body, ctx, true);
				case "AEXPR_IN": {
					const col = columnOf(body.lexpr, ctx);
					const items = (unwrap(body.rexpr)[1].items ?? []) as unknown[];
					const values = items.map((i) => constOf(i, ctx));
					if (!col || values.some((v) => v === null)) return UNCLEAR;
					const tags = either(
						(values as Value[]).map((v) => tag(valueName(v, col, ctx))),
					);
					return names(body.name)[0] === "="
						? fact(col, tags)
						: fact(col, [word("不是"), ...tags]);
				}
				case "AEXPR_BETWEEN":
				case "AEXPR_NOT_BETWEEN": {
					const col = columnOf(body.lexpr, ctx);
					const [lo, hi] = (unwrap(body.rexpr)[1].items ?? []) as unknown[];
					const a = termOf(lo, ctx, col);
					const b = termOf(hi, ctx, col);
					if (!col || !a || !b) return UNCLEAR;
					const no = body.kind === "AEXPR_NOT_BETWEEN" ? "不" : "";
					return fact(col, [
						word(`${no}在`),
						...a,
						word("到"),
						...b,
						word("之间"),
					]);
				}
				default:
					return UNCLEAR;
			}
		}
		case "NullTest": {
			const col = columnOf(body.arg, ctx);
			if (!col) return UNCLEAR;
			return fact(col, [
				word(body.nulltesttype === "IS_NULL" ? "为空" : "不为空"),
			]);
		}
		case "SubLink": {
			if (body.subLinkType !== "EXISTS_SUBLINK") return UNCLEAR;
			const sub = subquery(unwrap(body.subselect)[1], ctx);
			if (!sub) return UNCLEAR;
			const what = sub.stream ?? sub.rel.label;
			return {
				t: "nested",
				head: `有一${UNIT[sub.rel.name] ?? "条"}${what}这样`,
				inner: sub.inner,
			};
		}
		case "A_Const":
			return constOf(node, ctx) === true ? SKIP : UNCLEAR;
		default:
			return UNCLEAR;
	}
}

function and(items: Expr[]): Expr {
	const flat = items
		.flatMap((i) => (i.t === "and" ? i.items : [i]))
		.filter((i) => i.t !== "skip");
	if (flat.length === 0) return SKIP;
	return flat.length === 1 ? (flat[0] as Expr) : { t: "and", items: flat };
}

/**
 * 一行取值能和别的行合并时的样子：一个可选的连接字加一个取值（「含 甲」「甲」）；
 * 合并过的行是连接字加用「/」隔开的几个取值。别的样子（「甲 及以上」「不是 甲」）不合并。
 */
function mergeable(value: Piece[]): { lead: string | null } | null {
	const [first, ...rest] = value;
	const lead = first && "word" in first ? first.word : null;
	const tags = lead === null ? value : rest;
	if (lead?.startsWith("不")) return null;
	const ok =
		tags.length > 0 &&
		tags.every((p, i) =>
			i % 2 === 0 ? "tag" in p : "word" in p && p.word === "/",
		);
	return ok ? { lead } : null;
}

/** 「或」起来的几项；同一属性、同一种比较的合成一行：外部行业 甲 / 乙，部门路径 含 甲 / 乙。 */
function or(items: Expr[]): Expr {
	const flat = items.flatMap((i) => (i.t === "or" ? i.items : [i]));
	if (flat.some((i) => i.t === "skip")) return SKIP;
	const merged: Expr[] = [];
	for (const item of flat) {
		if (item.t !== "fact") {
			merged.push(item);
			continue;
		}
		const shape = !item.lead && mergeable(item.value);
		const into =
			shape &&
			merged.find(
				(m): m is Fact =>
					m.t === "fact" &&
					!m.lead &&
					m.field === item.field &&
					mergeable(m.value)?.lead === shape.lead,
			);
		if (into)
			into.value = [
				...into.value,
				word("/"),
				...item.value.filter((p) => "tag" in p),
			];
		else merged.push({ ...item, value: [...item.value] });
	}
	return merged.length === 1 ? (merged[0] as Expr) : { t: "or", items: merged };
}

/** 展开成几种之一，每一种是要同时满足的几行。 */
function options(e: Expr): Option[] {
	switch (e.t) {
		case "skip":
			return [];
		case "or": {
			const all = e.items.flatMap(options);
			return all.length <= OPTIONS_MAX ? all : [optionOf([nestedOr(e)])];
		}
		case "and": {
			let acc: Option[] = [optionOf([])];
			for (const item of e.items) {
				const next = options(item);
				if (next.length === 0) continue;
				acc =
					acc.length * next.length > OPTIONS_MAX
						? acc.map((a) => ({ ...a, rows: [...a.rows, nestedOr(item)] }))
						: acc.flatMap((a) =>
								next.map((n) => ({
									lead: n.lead ?? a.lead,
									rows: [...a.rows, ...n.rows],
								})),
							);
			}
			return acc;
		}
		case "fact":
			return [
				e.lead
					? { lead: e.lead, rows: [] }
					: {
							lead: null,
							rows: [{ kind: "fact", field: e.field, value: e.value }],
						},
			];
		case "unclear":
			return [optionOf([{ kind: "unclear" }])];
		case "nested":
			return [
				optionOf([
					{
						kind: "nested",
						head: e.head,
						options: e.inner ? options(e.inner) : [],
					},
				]),
			];
	}
}

function optionOf(rows: Row[]): Option {
	return { lead: null, rows };
}

/** 展开不下的那层「或」：留在一行里。 */
function nestedOr(e: Expr): Row {
	const inner = e.t === "or" ? e.items.flatMap(options) : options(e);
	return { kind: "nested", head: "符合下面任一种", options: inner };
}

/** 一条条件实际要什么。`where` 进不了记录的条件不会走到这里；万一翻不出整条，说不清楚。 */
export async function explainCondition(
	c: QueryCondition,
	streams: StreamNames,
): Promise<ConditionExplained> {
	const tree = await whereTree(c.where, c.params ?? {});
	const base = new Map<string, CatalogRelation>();
	if (c.from === "person")
		base.set("p", RELATIONS.get("person") as CatalogRelation);
	else {
		base.set("e", RELATIONS.get("experience") as CatalogRelation);
		base.set("h", HIT);
	}
	const expr = tree
		? translate(tree.clause, {
				scopes: [base],
				params: c.params ?? {},
				order: tree.order,
				streams,
			})
		: UNCLEAR;
	const criterion = c.seek?.criterion?.trim();
	return {
		work: c.seek
			? criterion
				? { criterion }
				: { written: either(c.seek.patterns.map(tag)) }
			: null,
		options: options(expr).filter((o) => o.lead !== null || o.rows.length > 0),
		months: c.minMonths ?? null,
	};
}

/** 记录流的名字，加上档位表里职级、学历两套档：名字和名单上方的筛选同一套。 */
async function streamNames(): Promise<StreamNames> {
	const rows = await db
		.select({ stream: recordStream.stream, label: recordStream.label })
		.from(recordStream);
	return new Map([
		[ORDINAL_STREAM.level, DIMENSIONS.level.label],
		[ORDINAL_STREAM.education, DIMENSIONS.education.label],
		...rows.map((r) => [r.stream, r.label] as const),
	]);
}

/** 给线程上的每一轮配上每条条件的说明。 */
export async function explainThread(thread: Turn[]): Promise<ThreadTurn[]> {
	const streams = await streamNames();
	return Promise.all(
		thread.map(async (turn) => ({
			...turn,
			explained: Object.fromEntries(
				await Promise.all(
					(turn.spec ? queryOfSpec(turn.spec).conditions : []).map(
						async (c) => [c.id, await explainCondition(c, streams)] as const,
					),
				),
			),
		})),
	);
}
