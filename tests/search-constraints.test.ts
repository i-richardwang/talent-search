/**
 * 库对写入的完整性要求：**这些错必须在写入那一刻就写不进去。**
 *
 * 日期倒置、零月经历、属于不存在的人的经历段、四类之外的路——每一种落进
 * 库里之后都只会表现为「名单有点怪」，不会有任何断言失败。所以它们归约束，不归
 * 应用代码：导入换一个适配器、检索换一种取数，这道关卡都还在。
 *
 * 按约束**名**判断（`fixture.ts` 的 `violates`）：按报错文案判断的话，被另一条约束拒绝
 * 也可能凑巧含着这几个字，测试照样通过。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { seed, setup, violates } from "./fixture";

const teardown = await setup();
after(teardown);

const { db } = await import("#/db");

before(async () => {
	// 一个人加一段经历：外键要有人可指，说法表要有一行原文可引用
	await seed([
		{
			empId: "C001",
			name: "约束用例",
			segments: [{ title: "深潜考据", months: 12 }],
		},
	]);
});

describe("检索数据约束", () => {
	test("待业标记属于内容身份，其他原始字段相同也区分两段", async () => {
		const { rows } = await db.execute<{ content_key: string }>(sql`
			insert into experience (emp_id, kind, unemployed, start_date, title, months)
			values ('C001', 'external', false, '2019-01-01', '相同原始字段', 12),
				('C001', 'external', true, '2019-01-01', '相同原始字段', 12)
			returning content_key`);
		assert.equal(new Set(rows.map((row) => row.content_key)).size, 2);
	});

	test("待业只能属于入职前经历", async () => {
		await assert.rejects(
			db.execute(sql`
			insert into experience (emp_id, kind, unemployed, start_date, months)
			values ('C001', 'internal', true, '2018-01-01', 12)`),
			violates("experience_unemployed_external"),
		);
	});

	const insert = (
		kind: string,
		start: string,
		end: string | null,
		months: number,
	) =>
		db.execute(sql`
			insert into experience (emp_id, kind, start_date, end_date, months)
			values ('C001', ${kind}, ${start}, ${end}, ${months})`);
	test("经历来源只能是公司内或入职前", async () => {
		await assert.rejects(
			insert("contractor", "2020-01-01", null, 1),
			violates("experience_kind_valid"),
		);
	});

	test("经历时长必须为正数", async () => {
		await assert.rejects(
			insert("internal", "2020-01-01", null, 0),
			violates("experience_months_positive"),
		);
	});

	test("结束日期不能早于开始日期", async () => {
		await assert.rejects(
			insert("external", "2020-02-01", "2020-01-01", 1),
			violates("experience_dates_ordered"),
		);
	});

	test("经历必须属于已存在的员工", async () => {
		await assert.rejects(
			db.execute(sql`
				insert into experience (emp_id, kind, start_date, months)
				values ('不存在', 'internal', '2020-01-01', 1)`),
			violates("experience_emp_id_employee_emp_id_fk"),
		);
	});

	test("说法的 route 只能是已知的几类", async () => {
		await assert.rejects(
			db.execute(sql`
				insert into experience_phrase (experience_id, route, phrase_id)
				values (1, 'summary', (select min(id) from phrase))`),
			violates("experience_phrase_route_valid_6"),
		);
	});

	test("同一串字只存一次：说法表按原文唯一", async () => {
		await assert.rejects(
			db.execute(sql`
				insert into phrase (text, embedding)
				select text, embedding from phrase limit 1`),
			violates("phrase_text_unique"),
		);
	});

	test("重排相关度只能在零到一之间", async () => {
		await assert.rejects(
			db.execute(sql`
				insert into rerank_cache (space, query, document_sha, relevance)
				values ('fake-v1', '非法分数', 'synthetic', 1.1)`),
			violates("rerank_cache_range"),
		);
	});
});
