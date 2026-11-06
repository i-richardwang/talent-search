/**
 * 查询条件里 SQL 的执行隔离，两层：
 *
 * - **解析层**（`compileWhere`）：用 Postgres 自己的解析器（libpg-query）把 `where` 读成语法树，
 *   必须是单个布尔表达式；只能引用数据目录（`search/catalog.ts`）里的关系和这一种条件允许的别名；
 *   节点、函数、类型都按白名单；`:name` 换成绑定参数。执行的是按词法单元重新拼出的文本
 *   （去掉注释、括号配平），不是模型的原文。
 * - **数据库层**（`restricted`）：在保存点里切到只读角色 `talent_query`，它只有目录视图的
 *   SELECT；同时只读、限时、限内存，`search_path` 只有目录和临时表。回滚到保存点后一切
 *   设置还原，调用方接着用应用角色读名单要显示的东西。
 */
import "@tanstack/react-start/server-only";
import { type SQL, sql } from "drizzle-orm";
import { loadModule, parseSync, type ScanToken, scanSync } from "libpg-query";
import { pool } from "#/db";
import type { DbExecutor } from "#/db/snapshot";
import { CATALOG, type CatalogRelation, HIT } from "#/search/catalog";

/** 只读角色的名字。它只有目录视图的 SELECT，由 `ensureQueryRole` 建好并授权。 */
const QUERY_ROLE = "talent_query";

/** 一条 `where` 最长几个字。写得出一条条件的 SQL 用不到这么长。 */
const WHERE_MAX = 2_000;

/** 一个参数值最长几个字。 */
const PARAM_TEXT_MAX = 200;

/** 一条语句最多跑多久、用多少内存。 */
const STATEMENT_TIMEOUT = "20s";
const WORK_MEM = "64MB";

/**
 * 目录所在的 schema。生产是 `catalog`（`db/schema.ts`）；同一个库里要放几套目录时（比如每个
 * 测试文件一套）用 `TALENT_CATALOG_SCHEMA` 指定。
 */
export function catalogSchema(): string {
	const name = process.env.TALENT_CATALOG_SCHEMA?.trim() || "catalog";
	if (!/^[a-z_][a-z0-9_]*$/.test(name))
		throw new Error(`TALENT_CATALOG_SCHEMA 不是合法的 schema 名：${name}`);
	return name;
}

/** 条件的两种 FROM：经历的段 `e`（有语义词时还有命中 `h`），或人 `p`。 */
export type WhereScope =
	| { from: "experience"; terms: boolean }
	| { from: "person" };

type ParamValue = string | number;

type CompiledWhere = { ok: true; sql: SQL } | { ok: false; problem: string };

const RELATIONS = new Map<string, CatalogRelation>(
	CATALOG.map((r) => [r.name, r]),
);

const EXPRESSION_NODES = new Set([
	"BoolExpr",
	"A_Expr",
	"A_Const",
	"ColumnRef",
	"ParamRef",
	"NullTest",
	"BooleanTest",
	"TypeCast",
	"FuncCall",
	"CaseExpr",
	"CaseWhen",
	"CoalesceExpr",
	"MinMaxExpr",
	"SubLink",
	"A_ArrayExpr",
	"A_Indirection",
	"A_Indices",
	"SQLValueFunction",
	"List",
]);

const A_EXPR_KINDS = new Set([
	"AEXPR_OP",
	"AEXPR_OP_ANY",
	"AEXPR_OP_ALL",
	"AEXPR_DISTINCT",
	"AEXPR_NOT_DISTINCT",
	"AEXPR_NULLIF",
	"AEXPR_IN",
	"AEXPR_LIKE",
	"AEXPR_ILIKE",
	"AEXPR_BETWEEN",
	"AEXPR_NOT_BETWEEN",
	"AEXPR_BETWEEN_SYM",
	"AEXPR_NOT_BETWEEN_SYM",
]);

const OPERATORS = new Set([
	"=",
	"<>",
	"!=",
	"<",
	">",
	"<=",
	">=",
	"+",
	"-",
	"*",
	"/",
	"%",
	"||",
	"~~",
	"!~~",
	"~~*",
	"!~~*",
	"~",
	"~*",
	"!~",
	"!~*",
	"&&",
	"@>",
	"<@",
]);

/** 函数白名单：日期、聚合、字符串、数值和数组的常用函数。`pg_catalog.` 前缀是语法糖展开出来的。 */
const FUNCTIONS = new Set([
	"date_trunc",
	"date_part",
	"extract",
	"age",
	"make_date",
	"make_interval",
	"to_char",
	"to_date",
	"overlaps",
	"count",
	"sum",
	"min",
	"max",
	"avg",
	"bool_and",
	"bool_or",
	"every",
	"array_agg",
	"string_agg",
	"lower",
	"upper",
	"length",
	"char_length",
	"strpos",
	"position",
	"substr",
	"substring",
	"btrim",
	"ltrim",
	"rtrim",
	"replace",
	"concat",
	"concat_ws",
	"left",
	"right",
	"starts_with",
	"split_part",
	"abs",
	"round",
	"floor",
	"ceil",
	"ceiling",
	"mod",
	"array_length",
	"cardinality",
	"array_position",
]);

const TYPES = new Set([
	"int2",
	"int4",
	"int8",
	"int",
	"integer",
	"bigint",
	"smallint",
	"numeric",
	"decimal",
	"float4",
	"float8",
	"real",
	"text",
	"varchar",
	"date",
	"timestamp",
	"timestamptz",
	"interval",
	"bool",
	"boolean",
]);

const SQL_VALUE_FUNCTIONS = new Set([
	"SVFOP_CURRENT_DATE",
	"SVFOP_CURRENT_TIMESTAMP",
	"SVFOP_LOCALTIMESTAMP",
]);

type AnyNode = Record<string, unknown>;

/**
 * 一个别名指向的关系：目录里的关系（核对列），子查询（列由 Postgres 核对），或者这里
 * 不能用、要告诉模型为什么的别名。
 */
type Bound = CatalogRelation | "subselect" | { unavailable: string };
type Scope = Map<string, Bound>;

class Rejected extends Error {}

function reject(message: string): never {
	throw new Rejected(message);
}

function names(list: unknown): string[] {
	return (Array.isArray(list) ? list : []).map((n) => {
		const s = (n as { String?: { sval?: string } }).String?.sval;
		if (s === undefined) reject("名字里只能是普通标识符");
		return s;
	});
}

/** 单个节点：`{ 类型: 内容 }`。 */
function unwrap(node: unknown): [string, AnyNode] {
	if (!node || typeof node !== "object") reject("语法树里有读不懂的部分");
	const entries = Object.entries(node as AnyNode);
	const [entry] = entries;
	if (entries.length !== 1 || !entry) reject("语法树里有读不懂的部分");
	return [entry[0], (entry[1] ?? {}) as AnyNode];
}

function walkAll(list: unknown, scopes: Scope[]) {
	for (const item of Array.isArray(list) ? list : []) walk(item, scopes);
}

function walk(node: unknown, scopes: Scope[]): void {
	if (node === undefined || node === null) return;
	const [type, body] = unwrap(node);
	if (type === "SelectStmt") {
		select(body, scopes);
		return;
	}
	if (!EXPRESSION_NODES.has(type))
		reject(`不允许的写法：${type}。条件只能是一个布尔表达式`);
	switch (type) {
		case "A_Const":
		case "ParamRef":
			return;
		case "SQLValueFunction":
			if (!SQL_VALUE_FUNCTIONS.has(String(body.op)))
				reject("只能用 current_date、current_timestamp 这类日期值");
			return;
		case "ColumnRef":
			column(body, scopes);
			return;
		case "A_Expr": {
			if (!A_EXPR_KINDS.has(String(body.kind)))
				reject(`不允许的运算：${String(body.kind)}`);
			for (const op of names(body.name))
				if (!OPERATORS.has(op)) reject(`不允许的运算符：${op}`);
			walk(body.lexpr, scopes);
			walk(body.rexpr, scopes);
			return;
		}
		case "List":
			walkAll(body.items, scopes);
			return;
		case "TypeCast":
			typeName(body.typeName);
			walk(body.arg, scopes);
			return;
		case "FuncCall":
			func(body, scopes);
			return;
		case "SubLink":
			walk(body.testexpr, scopes);
			for (const op of names(body.operName))
				if (!OPERATORS.has(op)) reject(`不允许的运算符：${op}`);
			walk(body.subselect, scopes);
			return;
		case "CaseExpr":
			walk(body.arg, scopes);
			walkAll(body.args, scopes);
			walk(body.defresult, scopes);
			return;
		case "CaseWhen":
			walk(body.expr, scopes);
			walk(body.result, scopes);
			return;
		case "A_Indirection":
			walk(body.arg, scopes);
			walkAll(body.indirection, scopes);
			return;
		case "A_Indices":
			walk(body.lidx, scopes);
			walk(body.uidx, scopes);
			return;
		case "A_ArrayExpr":
			walkAll(body.elements, scopes);
			return;
		default:
			// BoolExpr、NullTest、BooleanTest、CoalesceExpr、MinMaxExpr
			walk(body.arg, scopes);
			walkAll(body.args, scopes);
			return;
	}
}

function typeName(node: unknown) {
	const body = (node ?? {}) as AnyNode;
	const parts = names(body.names);
	const last = parts.at(-1);
	if (
		!last ||
		parts.length > 2 ||
		(parts.length === 2 && parts[0] !== "pg_catalog") ||
		!TYPES.has(last)
	)
		reject(`不允许的类型：${parts.join(".")}`);
}

function func(body: AnyNode, scopes: Scope[]) {
	const parts = names(body.funcname);
	const last = parts.at(-1)?.toLowerCase();
	if (
		!last ||
		parts.length > 2 ||
		(parts.length === 2 && parts[0] !== "pg_catalog") ||
		!FUNCTIONS.has(last)
	)
		reject(`不允许的函数：${parts.join(".")}`);
	if (body.over) reject("不允许窗口函数");
	if (body.func_variadic) reject("不允许 VARIADIC");
	walkAll(body.args, scopes);
	walk(body.agg_filter, scopes);
	for (const sort of Array.isArray(body.agg_order) ? body.agg_order : [])
		walk((unwrap(sort)[1] as AnyNode).node, scopes);
}

/**
 * 列引用必须能确定指向哪一个关系：带别名的按别名找；不带别名的只在最内层子查询里找，
 * 而且只能有一个关系有这一列。条件最外层不认不带别名的列：外壳在不同的地方把这条
 * 条件接到不同的关系上，不带别名的列在一处读的是段、在另一处可能读到人。
 */
function column(body: AnyNode, scopes: Scope[]) {
	const fields = Array.isArray(body.fields) ? body.fields : [];
	const star = fields.some((f) => unwrap(f)[0] === "A_Star");
	if (star) reject("不允许 * 列；计数写 count(*)");
	const parts = names(fields);
	if (parts.length === 2) {
		const [alias, name] = parts as [string, string];
		for (let i = scopes.length - 1; i >= 0; i--) {
			const bound = scopes[i]?.get(alias);
			if (bound === undefined) continue;
			if (typeof bound === "object" && "unavailable" in bound)
				reject(bound.unavailable);
			if (bound !== "subselect" && !Object.hasOwn(bound.columns, name))
				reject(`${bound.name} 没有 ${name} 这一列`);
			return;
		}
		reject(`别名 ${alias} 在这里不能用`);
	}
	if (parts.length !== 1) reject(`列引用写法不对：${parts.join(".")}`);
	const [name] = parts as [string];
	const inner = scopes.at(-1);
	if (!inner || scopes.length === BASE_SCOPES)
		reject(`列 ${name} 要带别名，例如 e.${name}`);
	const owners = [...inner.values()].filter(
		(bound) =>
			bound === "subselect" ||
			("columns" in bound && Object.hasOwn(bound.columns, name)),
	);
	if (owners.length !== 1 || owners[0] === "subselect")
		reject(`列 ${name} 要带别名`);
}

function isStar(node: unknown) {
	if (!node) return false;
	const [type, body] = unwrap(node);
	return (
		type === "ColumnRef" &&
		(Array.isArray(body.fields) ? body.fields : []).some(
			(f) => unwrap(f)[0] === "A_Star",
		)
	);
}

/** 条件的最外层只有一个作用域：外壳给的那几个别名。 */
const BASE_SCOPES = 1;

const SELECT_FIELDS = new Set([
	"targetList",
	"fromClause",
	"whereClause",
	"groupClause",
	"havingClause",
	"sortClause",
	"limitCount",
	"limitOffset",
	"limitOption",
	"distinctClause",
	"op",
]);

function select(body: AnyNode, outer: Scope[]) {
	for (const key of Object.keys(body))
		if (!SELECT_FIELDS.has(key)) reject(`子查询里不允许 ${key}`);
	if (body.op !== "SETOP_NONE") reject("子查询里不允许 UNION 这类集合运算");
	const scope: Scope = new Map();
	const scopes = [...outer, scope];
	for (const item of Array.isArray(body.fromClause) ? body.fromClause : [])
		fromItem(item, scope, scopes);
	for (const target of Array.isArray(body.targetList) ? body.targetList : []) {
		const [kind, t] = unwrap(target);
		if (kind !== "ResTarget") reject("子查询的输出写法不对");
		// select r.* / select * 只是在问有没有，不读哪一列
		if (!isStar(t.val)) walk(t.val, scopes);
	}
	walk(body.whereClause, scopes);
	walkAll(body.groupClause, scopes);
	walk(body.havingClause, scopes);
	for (const sort of Array.isArray(body.sortClause) ? body.sortClause : [])
		walk((unwrap(sort)[1] as AnyNode).node, scopes);
	walk(body.limitCount, scopes);
	walk(body.limitOffset, scopes);
	walkAll(
		(Array.isArray(body.distinctClause) ? body.distinctClause : []).filter(
			(d) => d && Object.keys(d as AnyNode).length > 0,
		),
		scopes,
	);
}

function fromItem(node: unknown, scope: Scope, scopes: Scope[]) {
	const [type, body] = unwrap(node);
	if (type === "RangeVar") {
		const relname = String(body.relname);
		if (body.schemaname !== undefined)
			reject(
				`关系名不带 schema：写 ${relname}，不写 ${String(body.schemaname)}.${relname}`,
			);
		if (relname === HIT.name)
			reject("hit 只能经别名 h 读，不能在子查询里另外 from 它");
		const relation = RELATIONS.get(relname);
		if (!relation) reject(`目录里没有 ${relname}`);
		const alias =
			((body.alias as AnyNode | undefined)?.aliasname as string | undefined) ??
			relname;
		scope.set(alias, relation);
		return;
	}
	if (type === "JoinExpr") {
		if (body.isNatural || body.usingClause)
			reject("连接条件写成 on …，不用 natural 或 using");
		fromItem(body.larg, scope, scopes);
		fromItem(body.rarg, scope, scopes);
		walk(body.quals, scopes);
		return;
	}
	if (type === "RangeSubselect") {
		if (body.lateral) reject("不允许 lateral");
		const alias = (body.alias as AnyNode | undefined)?.aliasname as
			| string
			| undefined;
		if (!alias) reject("FROM 里的子查询要有别名");
		walk(body.subquery, scopes.slice(0, -1));
		scope.set(alias, "subselect");
		return;
	}
	reject(`FROM 里不允许 ${type}`);
}

let loaded: Promise<void> | null = null;

/** 一个 `:name` 参数，或一段原样的 SQL 词法单元。 */
type Piece = { text: string } | { param: string };

/**
 * 不可信的 `where` 和参数 → 可以拼进外壳语句的 SQL 片段，或一句告诉模型哪里不对的话。
 */
export async function compileWhere(
	where: string,
	params: Readonly<Record<string, ParamValue>>,
	scope: WhereScope,
): Promise<CompiledWhere> {
	loaded ??= loadModule();
	await loaded;
	try {
		return { ok: true, sql: build(where, params, scope) };
	} catch (error) {
		if (error instanceof Rejected) return { ok: false, problem: error.message };
		if (error instanceof Error && error.name === "SqlError")
			return { ok: false, problem: `SQL 写错了：${error.message}` };
		throw error;
	}
}

function build(
	where: string,
	params: Readonly<Record<string, ParamValue>>,
	scope: WhereScope,
): SQL {
	if (!where.trim()) reject("where 是空的；不限就写 true");
	if (where.length > WHERE_MAX) reject(`where 超过 ${WHERE_MAX} 字`);
	for (const [name, value] of Object.entries(params)) {
		if (!/^[a-z_][a-z0-9_]*$/i.test(name)) reject(`参数名 ${name} 不合法`);
		if (
			typeof value === "number"
				? !Number.isFinite(value)
				: typeof value !== "string"
		)
			reject(`参数 ${name} 只能是字符串或数字`);
		if (typeof value === "string" && value.length > PARAM_TEXT_MAX)
			reject(`参数 ${name} 超过 ${PARAM_TEXT_MAX} 字`);
	}

	const tokens = scanSync(where).tokens.filter(
		(t) => t.tokenName !== "SQL_COMMENT" && t.tokenName !== "C_COMMENT",
	);
	const pieces: Piece[] = [];
	let depth = 0;
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i] as ScanToken;
		if (t.tokenName === "PARAM") reject("参数写成 :name，不写 $1");
		if (t.text === ";") reject("只能写一个表达式，不能有分号");
		if (t.text === "(") depth++;
		if (t.text === ")" && --depth < 0) reject("括号没有配对");
		const next = tokens[i + 1];
		if (
			t.text === ":" &&
			next &&
			next.start === t.end &&
			/^[a-z_][a-z0-9_]*$/i.test(next.text)
		) {
			if (!Object.hasOwn(params, next.text))
				reject(`:${next.text} 不在 params 里`);
			pieces.push({ param: next.text });
			i++;
			continue;
		}
		pieces.push({ text: t.text });
	}
	if (depth !== 0) reject("括号没有配对");
	const used = new Set(pieces.flatMap((p) => ("param" in p ? [p.param] : [])));
	for (const name of Object.keys(params))
		if (!used.has(name)) reject(`params 里的 ${name} 没有用到`);

	const order = [...used];
	const text = pieces
		.map((p) => ("param" in p ? `$${order.indexOf(p.param) + 1}` : p.text))
		.join(" ");
	const parsed = parseSync(`select 1 where ${text}`);
	const [stmt, ...rest] = parsed.stmts ?? [];
	if (!stmt || rest.length > 0) reject("只能写一个表达式");
	const [type, body] = unwrap(stmt.stmt);
	if (type !== "SelectStmt") reject("只能写一个表达式");
	const keys = Object.keys(body).filter(
		(k) => k !== "targetList" && k !== "limitOption" && k !== "op",
	);
	if (
		keys.length !== 1 ||
		keys[0] !== "whereClause" ||
		body.op !== "SETOP_NONE"
	)
		reject("只能写一个表达式");

	const base: Scope = new Map();
	const unavailable = (why: string) => ({ unavailable: why });
	if (scope.from === "person") {
		base.set("p", RELATIONS.get("person") as Bound);
		base.set(
			"e",
			unavailable("人的条件里没有 e；要看经历写子查询 from experience"),
		);
		base.set(
			"h",
			unavailable("人的条件里没有 h：按意思找的经历写成一条经历条件"),
		);
	} else {
		base.set("e", RELATIONS.get("experience") as Bound);
		base.set(
			"h",
			scope.terms ? HIT : unavailable("这条没有 terms，不能引用 h"),
		);
		base.set("p", unavailable("经历条件里没有 p；人的要求另写一条人的条件"));
	}
	walk(body.whereClause, [base]);

	const chunks = pieces.map((p) => {
		if ("text" in p) return sql.raw(p.text);
		const value = params[p.param] as ParamValue;
		return typeof value === "number"
			? sql`${sql.param(value)}::numeric`
			: sql`${sql.param(value)}`;
	});
	return sql`(${sql.join(chunks, sql.raw(" "))})`;
}

let provisioned: Promise<void> | null = null;

/**
 * 只读角色和它的授权：没有就建，目录里的视图都给 SELECT，目录 schema 给 USAGE，应用角色
 * 要能切过去。每个进程第一次执行前做一次，部署不另设一步；之后重建的视图靠默认授权。
 * 几个进程同时做时用 advisory lock 排队。
 */
async function ensureQueryRole(): Promise<void> {
	const schema = catalogSchema();
	const client = await pool.connect();
	try {
		await client.query("begin");
		await client.query("select pg_advisory_xact_lock(hashtext($1))", [
			QUERY_ROLE,
		]);
		await client.query(`do $$ begin
			if not exists (select from pg_roles where rolname = '${QUERY_ROLE}') then
				create role ${QUERY_ROLE} nologin noinherit nosuperuser nocreatedb nocreaterole;
			end if;
		end $$`);
		await client.query(`grant usage on schema ${schema} to ${QUERY_ROLE}`);
		await client.query(
			`grant select on all tables in schema ${schema} to ${QUERY_ROLE}`,
		);
		// 之后重建的视图（`db:push`）也带上授权，不必等进程重启
		await client.query(
			`alter default privileges in schema ${schema} grant select on tables to ${QUERY_ROLE}`,
		);
		const member = await client.query<{ ok: boolean }>(
			`select pg_has_role(current_user, '${QUERY_ROLE}', 'SET') as ok`,
		);
		if (!member.rows[0]?.ok)
			await client.query(`grant ${QUERY_ROLE} to current_user`);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback").catch(() => {});
		throw error;
	} finally {
		client.release();
	}
}

/** 每个进程第一次用到只读角色时建好、授权；失败了下次再试。 */
function provision(): Promise<void> {
	provisioned ??= ensureQueryRole().catch((error) => {
		provisioned = null;
		throw error;
	});
	return provisioned;
}

/**
 * 在当前事务的一个保存点里以只读角色跑 `run`，跑完（成功或失败）回滚到保存点：角色、
 * 只读、超时和 `search_path` 都还原，事务可以接着用。临时表 `hit` 要在进来之前建好、授权。
 */
export async function restricted<T>(
	store: DbExecutor,
	run: () => Promise<T>,
): Promise<T> {
	await provision();
	await store.execute(sql.raw("savepoint sandbox"));
	try {
		await store.execute(sql.raw(`set local role ${QUERY_ROLE}`));
		await store.execute(sql.raw("set local transaction_read_only = on"));
		await store.execute(
			sql.raw(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`),
		);
		await store.execute(sql.raw(`set local work_mem = '${WORK_MEM}'`));
		await store.execute(
			sql.raw(`set local search_path = ${catalogSchema()}, pg_temp`),
		);
		return await run();
	} finally {
		await store.execute(sql.raw("rollback to savepoint sandbox"));
		await store.execute(sql.raw("release savepoint sandbox"));
	}
}

/** 允许只读角色读这张临时表。表由应用角色在同一个事务里建。 */
export async function shareTemp(store: DbExecutor, table: string) {
	await provision();
	await store.execute(sql.raw(`grant select on ${table} to ${QUERY_ROLE}`));
}
