/**
 * 通用管线的不变量。
 *
 * 这里测的是「无论数据从哪来都必须成立」的那几条：非法区间必须被拒绝并报数、
 * 开放区间怎么封口、相邻段怎么合并、当前信息从哪派生。适配器自己的解析逻辑
 * 归各自的测试，不在这里。
 *
 * 全部对着 `build` 一个入口测：它是纯函数，进去三张表、出来两张表加一串话，
 * 所以每个用例读起来就是一句「源里长这样时，库里应该是什么」。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type RawRow, type SourceData, sourceData } from "#/corpus/contract";
import { build, UNEMPLOYED } from "#/corpus/pipeline";

const AS_OF = new Date("2024-06-30T00:00:00Z");

const PERSON = {
	emp_id: "E1",
	name: "某人",
	hire_date: "2020-01-01",
	education_level: "",
	school: "",
	recruitment: "",
};
const ASSIGNMENT = {
	emp_id: "E1",
	start_date: "2020-01-01",
	end_date: "",
	org: "部门",
	org_path: "公司/中心/部门",
	title: "岗位",
	level: "P6",
	seq_l1: "技术",
	seq_l2: "后端开发",
	seq_l3: "",
	segment_key: "K1",
};
const EXTERNAL = {
	emp_id: "E1",
	start_date: "2018-01-01",
	end_date: "",
	org: "某公司",
	title: "工程师",
	description: "",
	company_tag: "",
	industry: "",
	nature: "",
	unemployed: false,
};

function source(rows: {
	people?: Partial<typeof PERSON>[];
	assignments?: Partial<typeof ASSIGNMENT>[];
	external?: Partial<typeof EXTERNAL>[];
}): SourceData {
	return sourceData({
		employees: (rows.people ?? [{}]).map(
			(row): RawRow => ({ ...PERSON, ...row }),
		),
		assignments: (rows.assignments ?? []).map(
			(row): RawRow => ({ ...ASSIGNMENT, ...row }),
		),
		external: (rows.external ?? []).map(
			(row): RawRow => ({ ...EXTERNAL, ...row }),
		),
	});
}

/** 跑一次管线，把它说过的话一起交出来。 */
function run(rows: Parameters<typeof source>[0]) {
	const said: string[] = [];
	const out = build(source(rows), (line) => said.push(line), AS_OF);
	return { ...out, said: said.join("\n") };
}

const internal = (rows: ReturnType<typeof run>) =>
	rows.experience.filter((row) => row.kind === "internal");
const external = (rows: ReturnType<typeof run>) =>
	rows.experience.filter((row) => row.kind === "external");

describe("公司内经历", () => {
	test("非法区间一律拒绝并报数", () => {
		const out = run({
			people: [
				{ emp_id: "E1" },
				{ emp_id: "E2" },
				{ emp_id: "E3" },
				{ emp_id: "E4" },
			],
			assignments: [
				{ emp_id: "E1", start_date: "2020-01-01" },
				{ emp_id: "E2", start_date: "" },
				{ emp_id: "E3", start_date: "2030-01-01" },
				{ emp_id: "E4", start_date: "2020-05-01", end_date: "2020-01-01" },
			],
		});

		assert.deepEqual(
			internal(out).map((row) => row.emp_id),
			["E1"],
		);
		assert.match(out.said, /缺少开始日期 1 段，已拒绝导入/);
		assert.match(out.said, /生效日在未来 1 段，已拒绝导入/);
		assert.match(out.said, /日期倒置 1 段，已拒绝导入/);
	});

	test("读不懂的结束日被拒绝，不会变成「至今」", () => {
		const out = run({
			people: [{ emp_id: "E1" }, { emp_id: "E2" }],
			assignments: [
				{ emp_id: "E1", start_date: "2020-01-01", end_date: "not-a-date" },
				{ emp_id: "E2", start_date: "2020-01-01" },
			],
		});

		assert.deepEqual(
			internal(out).map((row) => row.emp_id),
			["E2"],
		);
		assert.match(out.said, /日期格式无效 1 段，已拒绝导入/);
	});

	test("结束日晚于今天也是脏数据", () => {
		const out = run({
			people: [{ emp_id: "E1" }, { emp_id: "E2" }],
			assignments: [
				{ emp_id: "E1", start_date: "2020-01-01", end_date: "2030-01-01" },
				{ emp_id: "E2", start_date: "2020-01-01", end_date: "2024-06-30" },
			],
		});

		assert.deepEqual(
			internal(out).map((row) => row.emp_id),
			["E2"],
		);
		assert.match(out.said, /结束日在未来 1 段，已拒绝导入/);
	});

	test("同一个 key 的相邻段合并，时长按合并后的区间重算", () => {
		const out = run({
			assignments: [
				{ start_date: "2024-01-01", end_date: "2024-01-31" },
				{ start_date: "2024-02-01" },
			],
		});

		const [segment] = internal(out);
		assert.equal(internal(out).length, 1);
		assert.equal(segment?.end_date, null);
		// 合并后按「第一段起始 → 今天」重算，不是两段月数相加
		assert.equal(segment?.months, 6);
	});

	test("重叠的同 key 段也是一段", () => {
		const out = run({
			assignments: [
				{ start_date: "2024-01-01", end_date: "2024-03-31" },
				{ start_date: "2024-02-01", end_date: "2024-02-15" },
			],
		});

		const [segment] = internal(out);
		assert.equal(internal(out).length, 1);
		assert.equal(segment?.start_date, "2024-01-01");
		assert.equal(segment?.end_date, "2024-03-31");
		assert.equal(segment?.months, 3);
	});

	test("key 不同就是两段", () => {
		const out = run({
			assignments: [
				{ start_date: "2024-01-01", end_date: "2024-01-31" },
				{ start_date: "2024-02-01", segment_key: "K2" },
			],
		});

		assert.equal(internal(out).length, 2);
	});

	test("同 key 但中间断开，仍是两段", () => {
		const out = run({
			assignments: [
				{ start_date: "2020-01-01", end_date: "2020-12-31" },
				{ start_date: "2024-01-01", end_date: "2024-06-30" },
			],
		});

		assert.deepEqual(
			internal(out).map((row) => row.months),
			[12, 6],
		);
	});

	test("中间夹了另一段别的 key，也不妨碍这一头合并", () => {
		const out = run({
			assignments: [
				{ start_date: "2024-01-01", end_date: "2024-03-31" },
				{ start_date: "2024-02-01", end_date: "2024-02-29", segment_key: "K2" },
				{ start_date: "2024-04-01", end_date: "2024-06-30" },
			],
		});

		assert.equal(internal(out).length, 2);
		assert.equal(internal(out).find((row) => row.months === 6)?.months, 6);
	});

	test("没有 segment_key 的段各自成段，并报出来", () => {
		const out = run({
			assignments: [
				{ start_date: "2024-01-01", end_date: "2024-01-31", segment_key: "" },
				{ start_date: "2024-02-01", end_date: "2024-02-29", segment_key: "" },
			],
		});

		assert.equal(internal(out).length, 2);
		assert.match(out.said, /缺少 segment_key 2 段，已保留为独立经历/);
	});

	test("同一个 key 落在两个人身上，永远不合并", () => {
		const out = run({
			people: [{ emp_id: "E1" }, { emp_id: "E2" }],
			assignments: [
				{ emp_id: "E1", start_date: "2024-01-01", end_date: "2024-01-31" },
				{ emp_id: "E2", start_date: "2024-02-01" },
			],
		});

		assert.deepEqual(
			internal(out).map((row) => row.emp_id),
			["E1", "E2"],
		);
	});
});

describe("入职前经历", () => {
	test("开放区间封到入职日；没有入职日的封不上，拒绝", () => {
		const out = run({
			people: [
				{ emp_id: "E1", hire_date: "2021-01-01" },
				{ emp_id: "E2", hire_date: "" },
			],
			external: [
				{ emp_id: "E1", start_date: "2020-01-01" },
				{ emp_id: "E2", start_date: "2020-01-01" },
			],
		});

		assert.deepEqual(
			external(out).map((row) => row.emp_id),
			["E1"],
		);
		assert.equal(external(out)[0]?.end_date, "2021-01-01");
		assert.match(out.said, /无入职日 1 段，已拒绝导入/);
	});

	test("结束日晚于入职日的段读不通，拒绝；恰好等于入职日是合法边界", () => {
		const out = run({
			people: [{ emp_id: "E1", hire_date: "2021-01-01" }],
			external: [
				{ start_date: "2019-01-01", end_date: "2021-06-01" },
				{ start_date: "2018-01-01", end_date: "2021-01-01" },
			],
		});

		assert.deepEqual(
			external(out).map((row) => row.end_date),
			["2021-01-01"],
		);
		assert.match(out.said, /晚于入职日 1 段，已拒绝导入/);
	});

	test("读不懂的结束日不会被入职日补上", () => {
		const out = run({
			people: [{ emp_id: "E1", hire_date: "2021-01-01" }],
			external: [{ start_date: "2020-01-01", end_date: "bad" }],
		});

		assert.equal(external(out).length, 0);
		assert.match(out.said, /日期格式无效 1 段，已拒绝导入/);
	});

	test("待业段显示为待业，且不带描述", () => {
		const out = run({
			external: [
				{
					start_date: "2019-01-01",
					end_date: "2019-06-30",
					description: "不该留下来的描述",
					unemployed: true,
				},
			],
		});

		assert.equal(external(out)[0]?.title, UNEMPLOYED);
		assert.equal(external(out)[0]?.description, "");
	});

	test("公司属性只留非空项，全空写 null", () => {
		const out = run({
			people: [{ emp_id: "E1" }, { emp_id: "E2" }],
			external: [
				{
					emp_id: "E1",
					start_date: "2019-01-01",
					end_date: "2019-06-30",
					company_tag: "大厂",
				},
				{ emp_id: "E2", start_date: "2019-01-01", end_date: "2019-06-30" },
			],
		});

		assert.deepEqual(external(out)[0]?.org_meta, { company_tag: "大厂" });
		// 三项全空写 null，不写 `{}`——空对象读起来像「有属性但都是空的」
		assert.equal(external(out)[1]?.org_meta, null);
	});

	test("待业标记不是布尔就是适配器坏了，整轮出声退出", () => {
		assert.throws(
			() =>
				sourceData({
					employees: [{ ...PERSON }],
					assignments: [],
					external: [{ ...EXTERNAL, unemployed: "false" }],
				}),
			/unemployed 不是布尔值/,
		);
	});
});

describe("员工档案", () => {
	test("当前信息来自那一段还开着的公司内经历", () => {
		const out = run({
			assignments: [
				{ start_date: "2020-01-01", end_date: "2021-12-31", title: "旧岗位" },
				{ start_date: "2022-01-01", title: "现岗位", segment_key: "K2" },
			],
		});

		assert.equal(out.employee[0]?.cur_title, "现岗位");
		assert.equal(out.employee[0]?.cur_dept, "部门");
	});

	test("已经结束的历史段不是当前", () => {
		const out = run({
			assignments: [
				{ start_date: "2020-01-01", end_date: "2021-12-31", title: "历史岗位" },
			],
		});

		assert.equal(out.employee[0]?.cur_title, "");
	});

	test("同时开着两段时当前字段留空，并报出冲突", () => {
		const out = run({
			assignments: [
				{ start_date: "2023-01-01", segment_key: "K1" },
				{ start_date: "2024-01-01", segment_key: "K2" },
			],
		});

		assert.equal(out.employee[0]?.cur_title, "");
		assert.match(out.said, /当前公司内经历冲突 1 人/);
	});

	test("一段经历都没有的人照样进库", () => {
		const out = run({ people: [{ emp_id: "E1", name: "只有档案" }] });

		assert.equal(out.employee[0]?.name, "只有档案");
		assert.equal(out.employee[0]?.cur_title, "");
	});

	test("读不懂的入职日留空并说一句，不拒绝这个人", () => {
		const out = run({ people: [{ emp_id: "E1", hire_date: "bad" }] });

		assert.equal(out.employee[0]?.hire_date, null);
		assert.match(out.said, /入职日期格式无效 1 行，入职日已留空/);
	});
});

describe("人群", () => {
	test("没有工号的档案行被拒绝并报数", () => {
		const out = run({
			people: [{ emp_id: "E1" }, { emp_id: "" }, { emp_id: "   " }],
			assignments: [{ emp_id: "E1", start_date: "2020-01-01" }],
		});

		assert.deepEqual(
			out.employee.map((row) => row.emp_id),
			["E1"],
		);
		assert.match(out.said, /员工档案缺少工号 2 行，已拒绝导入/);
	});

	test("指向库外的经历段一律丢弃", () => {
		const out = run({
			people: [{ emp_id: "E1", name: "在册" }],
			assignments: [
				{ emp_id: "E1", start_date: "2020-01-01" },
				{ emp_id: "E9", start_date: "2020-01-01" },
			],
		});

		assert.deepEqual(
			out.experience.map((row) => row.emp_id),
			["E1"],
		);
		assert.match(out.said, /不属于本次人群/);
	});

	test("整行重复只是导出毛刺，去重后不算冲突", () => {
		const out = run({
			people: [
				{ emp_id: "E1", name: "重复导出" },
				{ emp_id: "E1", name: "重复导出" },
			],
			assignments: [{ emp_id: "E1", start_date: "2020-01-01" }],
		});

		assert.deepEqual(
			out.employee.map((row) => row.emp_id),
			["E1"],
		);
		assert.match(out.said, /整行重复 1 行/);
		assert.doesNotMatch(out.said, /字段冲突/);
	});

	test("同工号但字段不同，连人带经历一起拒绝", () => {
		const out = run({
			people: [
				{ emp_id: "E1", name: "一个名字" },
				{ emp_id: "E1", name: "另一个名字" },
				{ emp_id: "E2", name: "无辜路人" },
			],
			assignments: [
				{ emp_id: "E1", start_date: "2020-01-01" },
				{ emp_id: "E2", start_date: "2020-01-01" },
			],
		});

		assert.deepEqual(
			out.employee.map((row) => row.emp_id),
			["E2"],
		);
		assert.deepEqual(
			out.experience.map((row) => row.emp_id),
			["E2"],
		);
		assert.match(out.said, /字段冲突 1 人/);
		assert.match(out.said, /E1/);
	});
});

describe("契约", () => {
	test("缺一列就按名字报出来", () => {
		assert.throws(
			() =>
				sourceData({
					employees: [{ emp_id: "E1" }],
					assignments: [],
					external: [],
				}),
			/hire_date/,
		);
	});
});
