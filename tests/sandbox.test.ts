/**
 * 条件 SQL 的两层隔离：解析白名单（`compileWhere`）挡住目录以外的关系、函数和语句；
 * 解析层漏过的，只读角色（`restricted`）在数据库里再挡一次。关键词链的条件表编译出的
 * 每一种写法都要过得了白名单。
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { conditionsOfKeywords } from "#/search/keywords";
import { parseQuery } from "#/search/query-syntax";
import { claim, person } from "./conditions";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { catalogSchema } = await import("#/search/catalog");
const { compileWhere, createVetoed, restricted } = await import(
	"#/server/sandbox"
);
const { compileConditions } = await import("#/search/compile");
const { scopeOf } = await import("#/search/execute");
const { db } = await import("#/db");
const { sql } = await import("drizzle-orm");
const { PgDialect } = await import("drizzle-orm/pg-core");

const EXPERIENCE = { from: "experience", terms: false } as const;
const WITH_HIT = { from: "experience", terms: true } as const;
const PERSON = { from: "person" } as const;

type Scope = Parameters<typeof compileWhere>[2];

async function problem(
	where: string,
	scope: Scope = PERSON,
	params: Record<string, string | number> = {},
) {
	const result = await compileWhere(where, params, scope);
	assert.equal(result.ok, false, `应当拒绝：${where}`);
	return result.ok ? "" : result.problem;
}

async function text(
	where: string,
	scope: Scope = PERSON,
	params: Record<string, string | number> = {},
) {
	const result = await compileWhere(where, params, scope);
	if (!result.ok) assert.fail(`应当接受：${where}\n${result.problem}`);
	return new PgDialect().sqlToQuery(result.sql);
}

describe("解析白名单接受的写法", () => {
	test("三年内至少两期 A 及以上：评级子查询、档位表、日期运算", async () => {
		const q = await text(
			`(select count(*) from rating r where r.emp_id = p.emp_id
				and r.stream = :stream and r.period_end >= current_date - interval '3 years'
				and r.value_rank >= (select s.rank from scale s where s.stream = :stream and s.value = :band)) >= 2`,
			PERSON,
			{ stream: "perf", band: "A" },
		);
		assert.deepEqual(q.params, ["perf", "perf", "A"]);
	});

	test("工号作关联键：和另一列工号比相等、在 count 里、在 group by 里", async () => {
		await text("exists (select 1 from rating r where p.emp_id = r.emp_id)");
		await text(
			"(select count(r.emp_id) from rating r where r.emp_id = p.emp_id) >= 2",
		);
		await text(
			`exists (select 1 from rating r where r.emp_id = p.emp_id
				group by r.emp_id having count(*) >= 2)`,
		);
	});

	test("从没拿过 C：否定同时要求有记录", async () => {
		await text(
			`exists (select 1 from rating r where r.emp_id = p.emp_id and r.stream = 'perf')
			and not exists (select 1 from rating r where r.emp_id = p.emp_id and r.stream = 'perf' and r.value = 'C')`,
		);
	});

	test("限定公司内、按命中的说法类别筛", async () => {
		await text(
			"e.kind = 'internal' and h.route in ('role', 'skill')",
			WITH_HIT,
		);
	});

	test("注释去掉，参数绑定，数字参数按数值比", async () => {
		const q = await text("e.months >= :m -- ' or true", EXPERIENCE, { m: 24 });
		assert.ok(!q.sql.includes("--"), q.sql);
		assert.ok(q.sql.includes("::numeric"), q.sql);
		assert.deepEqual(q.params, [24]);
	});

	test("关键词链的条件表和关键词框编译出的每一种写法都过得了白名单", async () => {
		const conditions = [
			...parseQuery(
				"算法 kind:external companyTag:大厂 minMonths:24,+产品 company:甲辰,-实习 minMonths:6",
			),
			claim("增长", { department: ["增长部"] }),
			person("level", ["P6", "P7"]),
			person("school", ["某大学"], "boost"),
			person("overseas", ["是"]),
			{ about: "person", mode: "must", field: "education", atLeast: "硕士" },
			{ about: "person", mode: "boost", field: "level", atLeast: "P6" },
			...conditionsOfKeywords({
				what: ["推荐"],
				company: ["乙未"],
				department: ["推荐部"],
				school: ["某学院"],
				minMonths: 36,
			}),
		] as const;
		for (const c of compileConditions([...conditions]).conditions) {
			const result = await compileWhere(c.where, c.params ?? {}, scopeOf(c));
			assert.ok(result.ok, `${c.label}：${result.ok ? "" : result.problem}`);
		}
	});
});

describe("解析白名单拒绝的写法", () => {
	/** 名字、写法、拒绝理由里该有的字（回给模型的那句话要说中原因）、条件的 FROM。 */
	const cases: [string, string, RegExp, Scope?][] = [
		["带 schema 的关系", "exists (select 1 from public.employee x)", /schema/],
		["目录以外的关系", "exists (select 1 from employee x)", /目录里没有/],
		["系统表", "exists (select 1 from pg_authid a)", /目录里没有/],
		[
			"命中表只能经别名 h 读",
			"exists (select 1 from hit x)",
			/别名 h/,
			WITH_HIT,
		],
		["睡眠", "pg_sleep(1) is not null", /pg_sleep/],
		["读文件", "length(pg_read_file('/etc/passwd')) > 0", /pg_read_file/],
		["改设置", "set_config('role', 'talent', false) is not null", /set_config/],
		["多条语句", "true; drop table employee", /分号/],
		["括号提前闭合", "true) or (true", /括号/],
		["位置参数", "p.level_rank > $1", /:name/],
		["经历条件读不到人", "p.level_band = 'P7'", /没有 p/, EXPERIENCE],
		["没写语义词就没有命中", "h.relevance > 0.9", /terms/, EXPERIENCE],
		["人的条件读不到段", "e.kind = 'internal'", /没有 e/],
		[
			"目录里没有的列",
			"e.description like '%x%'",
			/没有 description/,
			EXPERIENCE,
		],
		[
			"窗口函数",
			"e.months > (select max(x.months) over () from experience x limit 1)",
			/窗口/,
			EXPERIENCE,
		],
		[
			"FROM 里的派生表",
			"exists (select 1 from (select r.value from rating r) x)",
			/只能写目录里的关系/,
		],
		[
			"lateral",
			"exists (select 1 from person x, lateral (select 1) y)",
			/只能写目录里的关系/,
		],
		[
			"工号只和工号比",
			"exists (select 1 from experience x where p.emp_id = x.title)",
			/emp_id 只作关联键/,
		],
		["工号和常量比", "p.emp_id = 'S1'", /emp_id 只作关联键/],
		[
			"别名带列名表",
			"exists (select 1 from rating x(a, b) where x.a = p.emp_id)",
			/别名只换关系名/,
		],
		[
			"连接带别名",
			"exists (select 1 from (rating r join status s on r.emp_id = s.emp_id) as j)",
			/连接不带别名/,
		],
		["不是布尔表达式里的语句", "true union select 1", /一个表达式/],
	];
	for (const [name, where, reason, scope] of cases)
		test(name, async () => {
			assert.match(await problem(where, scope), reason);
		});

	test("派生表把工号换成参数：一次计数缩到一个人，不放行", async () => {
		assert.match(
			await problem(
				"exists (select 1 from (select :target as k) x where p.emp_id = x.k)",
				PERSON,
				{ target: "S1" },
			),
			/只能写目录里的关系/,
		);
	});

	test("别名按位置把工号改名成学校：拿它和参数比，不放行", async () => {
		assert.match(
			await problem(
				"exists (select 1 from person x(school) where x.school = :target)",
				PERSON,
				{ target: "S1" },
			),
			/别名只换关系名/,
		);
	});

	test("参数必须用到、用到的必须给", async () => {
		assert.match(await problem("p.level_band = :band", PERSON), /band/);
		assert.match(await problem("true", PERSON, { band: "P7" }), /band/);
	});
});

describe("只读角色", () => {
	/** 在一个事务里以只读角色跑一句，返回 SQLSTATE；跑通了返回 null。 */
	async function refused(statement: ReturnType<typeof sql>) {
		return db.transaction(async (tx) => {
			await createVetoed(tx);
			try {
				await restricted(tx, () => tx.execute(statement));
				return null;
			} catch (error) {
				const cause = (error as { cause?: { code?: string } }).cause;
				return cause?.code ?? "unknown";
			}
		});
	}

	test("读得到目录视图", async () => {
		assert.equal(await refused(sql`select count(*) from person`), null);
		assert.equal(await refused(sql`select count(*) from rating`), null);
	});

	test("解析层漏过的也读不到原表：没有权限", async () => {
		const [{ schema } = { schema: "" }] = (
			await db.execute<{ schema: string }>(
				sql`select current_schema() as schema`,
			)
		).rows;
		assert.equal(
			await refused(
				sql`select count(*) from ${sql.identifier(schema)}.employee`,
			),
			"42501",
		);
		assert.equal(
			await refused(
				sql`select count(*) from ${sql.identifier(schema)}.experience_phrase`,
			),
			"42501",
		);
	});

	test("只读：建表、写入都不行，否决段也写不进", async () => {
		assert.equal(await refused(sql`create temp table x (a int)`), "25006");
		assert.equal(
			await refused(sql`insert into vetoed values (0, 1, 'S1')`),
			"42501",
		);
	});

	test("读到的经历不含否决段，目录的原始经历照样在；出了保存点，遮住它的视图也没了", async () => {
		await seed([
			{ empId: "S1", name: "甲", segments: [{ title: "实习生", months: 6 }] },
			{ empId: "S2", name: "乙", segments: [{ title: "工程师", months: 24 }] },
		]);
		const catalog = sql.identifier(catalogSchema());
		const seen = await db.transaction(async (tx) => {
			await createVetoed(tx);
			const [intern] = (
				await tx.execute<{ id: number }>(
					sql`select id from ${catalog}.experience where emp_id = 'S1'`,
				)
			).rows;
			assert.ok(intern);
			await tx.execute(sql`insert into vetoed values (0, ${intern.id}, 'S1')`);
			const inside = await restricted(tx, () =>
				tx.execute<{ raw: string[]; read: string[] }>(sql`select
					array(select emp_id from ${catalog}.experience order by emp_id) as raw,
					array(select emp_id from experience order by emp_id) as read`),
			);
			const after = await tx.execute<{ shadow: string | null }>(
				sql`select to_regclass('pg_temp.experience')::text as shadow`,
			);
			return { ...inside.rows[0], shadow: after.rows[0]?.shadow };
		});
		assert.deepEqual(seen, { raw: ["S1", "S2"], read: ["S2"], shadow: null });
	});

	test("出了保存点回到应用角色，事务接着可用", async () => {
		const role = await db.transaction(async (tx) => {
			await createVetoed(tx);
			const inside = await restricted(tx, () =>
				tx.execute<{ who: string }>(sql`select current_user as who`),
			);
			const outside = await tx.execute<{ who: string }>(
				sql`select current_user as who`,
			);
			return { inside: inside.rows[0]?.who, outside: outside.rows[0]?.who };
		});
		assert.equal(role.inside, "talent_query");
		assert.notEqual(role.outside, "talent_query");
	});
});
