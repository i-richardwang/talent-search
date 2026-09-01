/**
 * 检索语义的集成测试。跑在临时 schema 上的真 SQL。
 *
 * 打分本身不在这里——它是纯函数，钉在 `tests/rank.test.ts`，不必起数据库。
 * 这里管的是打分**够得着的事实**：路径判成了哪一路、月数和结束日期有没有
 * 原样传到打分那一层。列名或日期序列化错误只有
 * 走真 SQL 才看得见，而纯函数测试对它完全无感。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { parseChips } from "#/search/parse";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

// import 必须在 setup() 之后：#/db 在模块求值时就绑死了连接串
const { overview, search, sanitizeLimit } = await import("#/search/search");
const { db } = await import("#/db");
const { RESULT_PAGE, RESULT_MAX } = await import("#/search/weights");

before(async () => {
	await seed([
		{
			empId: "T001",
			name: "两词都受控",
			segments: [
				{ seqL2: "算法", months: 36 },
				{ title: "运营专员", months: 24, kind: "external" },
			],
		},
		{
			empId: "T002",
			name: "只命中一个词",
			segments: [{ title: "算法工程师", months: 36 }],
		},
		{
			empId: "T003",
			name: "两词都只是简历里提过",
			segments: [
				{
					kind: "external",
					months: 36,
					org: "某公司",
					description: "配合算法团队做过一些运营支持",
				},
			],
		},
		{
			empId: "T004",
			name: "同段既在部门名又在简历里",
			segments: [{ org: "安全部", description: "负责安全巡检", months: 36 }],
		},
		{
			empId: "T005",
			name: "同一个词命中长短两段",
			segments: [
				{ seqL2: "算法", months: 3 },
				{ seqL2: "算法", months: 36 },
				{ title: "运营专员", months: 36 },
			],
		},
		{
			empId: "T006",
			name: "序列里写着渠道运营",
			segments: [{ seqL2: "渠道运营", months: 36 }],
		},
	]);
});

describe("经历数据约束", () => {
	const insert = (
		kind: string,
		start: string,
		end: string | null,
		months: number,
	) =>
		db.execute(sql`
			insert into experience (emp_id, kind, start_date, end_date, months)
			values ('T001', ${kind}, ${start}, ${end}, ${months})`);
	const violates = (constraint: string) => (error: unknown) =>
		error instanceof Error &&
		error.cause instanceof Error &&
		error.cause.message.includes(constraint);

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
});

describe("AND 语义", () => {
	test("每个概念词都要命中，缺一个就被淘汰", async () => {
		const { results } = await search(parseChips("算法 运营"));
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T001"), "两词都命中的人应当在结果里");
		assert.ok(!ids.includes("T002"), "只命中「算法」的人必须被淘汰");
	});

	test("两个词可以落在不同的经历段上", async () => {
		const { results } = await search(parseChips("算法 运营"));
		const t001 = results.find((r) => r.employee.empId === "T001");
		const segs = new Set(t001?.hits.map((h) => h.experienceId));
		assert.equal(segs.size, 2, "两个词应当来自两段不同的经历");
	});

	test("没有可检索概念词时不返回任何人", async () => {
		const { terms, results } = await search(parseChips("帮我找一下的人"));
		assert.equal(terms.length, 0);
		assert.equal(results.length, 0);
	});
});

describe("命中路径判定", () => {
	test("一段同时命中多路时取权重最高的那一路", async () => {
		// 「安全」既在 org（0.5）又在 description（0.25）里，必须判成 org。
		// CASE 分支顺序一旦写反，这里就会变成 description。
		const { results } = await search(parseChips("安全"));
		const hit = results
			.find((r) => r.employee.empId === "T004")
			?.hits.find((h) => h.term === "安全");
		assert.equal(hit?.route, "org");
	});

	test("受控字段命中排在仅简历自述之前", async () => {
		const { results } = await search(parseChips("算法 运营"));
		const rank = results.map((r) => r.employee.empId);
		assert.ok(
			rank.indexOf("T001") < rank.indexOf("T003"),
			"序列＋岗位命中应当排在两词都只是简历提及的人之前",
		);
	});
});

/**
 * 打分够得着的事实。
 *
 * 打分公式本身在 rank.test.ts 里钉死，这里只验一件事：**月数和结束日期确实
 * 原样穿过了 SQL 到达打分层**。这两个字段任何一个在取数那一层丢掉或者写错列名，
 * 纯函数测试都照样全绿，而界面上的表现是「排序看起来有点怪」——没有任何断言会红。
 */
describe("月数与结束日期到得了打分层", () => {
	before(async () => {
		await seed([
			{
				empId: "R001",
				name: "还在做",
				segments: [{ seqL2: "考古", months: 24 }],
			},
			{
				empId: "R002",
				name: "十年前做过",
				segments: [{ seqL2: "考古", months: 24, endDate: "2015-01-01" }],
			},
			{
				empId: "R003",
				name: "还在做且做得久",
				segments: [
					{ seqL2: "考古", months: 24 },
					{ seqL2: "考古", months: 24 },
				],
			},
		]);
	});

	test("还在做的排在早就不做的前面", async () => {
		const { results } = await search(parseChips("考古"));
		const rank = results.map((r) => r.employee.empId);
		assert.ok(
			rank.indexOf("R001") < rank.indexOf("R002"),
			"近因因子没生效：end_date 没传到打分层",
		);
	});

	test("累计时长合并同一路径的全部经历段", async () => {
		const { results } = await search(parseChips("考古"));
		const rank = results.map((r) => r.employee.empId);
		assert.ok(
			rank.indexOf("R003") < rank.indexOf("R001"),
			"两段 24 个月应当胜过一段 24 个月",
		);
	});

	test("同一批人不会再挤成一个分数", async () => {
		const { results } = await search(parseChips("考古"));
		const scores = new Set(results.map((r) => r.score));
		assert.equal(scores.size, 3, "三个人三个分数，排序才有分辨率");
	});
});

describe("整词搜不到时退到语料里的子串", () => {
	test("「线下渠道运营」退成「渠道运营」并如实上报", async () => {
		const { terms, results } = await search(parseChips("线下渠道运营"));
		assert.equal(terms[0]?.term, "线下渠道运营");
		assert.equal(terms[0]?.members[0]?.effective, "渠道运营");
		assert.ok(results.some((r) => r.employee.empId === "T006"));
	});

	test("语料里完全没有的词不做无意义的退让", async () => {
		const { terms, results } = await search(parseChips("量子炼金"));
		assert.equal(terms[0]?.members[0]?.effective, "量子炼金");
		assert.equal(results.length, 0);
	});

	/*
	 * 松弛只看语料，不看筛选。让筛选参与的话，同一句话在不同筛选下会退成
	 * 不同的词，于是「加一个条件」可能搜出更多人，而左栏分面是按当前这个词
	 * 算出来的，它承诺的「点了还剩几人」会全部落空。
	 */
	test("退到哪一步只由查询串和语料决定，和筛选无关", async () => {
		const plain = await search(parseChips("线下渠道运营"));
		for (const filters of [
			{ kind: "external" as const },
			{ minMonths: 30 },
			{ seqL1: "不存在的序列" },
		]) {
			const got = await search(parseChips("线下渠道运营"), filters);
			assert.equal(
				got.terms[0]?.members[0]?.effective,
				plain.terms[0]?.members[0]?.effective,
				`筛选 ${JSON.stringify(filters)} 改变了检索词`,
			);
		}
	});

	test("收窄筛选只会让人变少，不会变多", async () => {
		const plain = await search(parseChips("线下渠道运营"));
		const narrowed = await search(parseChips("线下渠道运营"), {
			kind: "external",
		});
		assert.ok(
			narrowed.total <= plain.total,
			`加筛选后从 ${plain.total} 人涨到了 ${narrowed.total} 人`,
		);
	});
});

/**
 * 用户输入里的 ILIKE 元字符。
 *
 * 不转义的话「%%」两个字符就让每一行恒真：分面要对全表分组、命中表要排序
 * 全表，返回全库每一个人。这既是一个两字符就能触发的放大面，也是普通用户
 * 输入「增长100%」时的静默语义错误。
 */
describe("通配符只能是字面量", () => {
	test("百分号不匹配任意串", async () => {
		const { results } = await search(parseChips("%%"));
		assert.equal(results.length, 0);
	});

	test("下划线不匹配任意一个字", async () => {
		// 库里有「算法工程师」，但「算_法」不该因此命中
		const { terms, results } = await search(parseChips("算_法"));
		assert.equal(terms[0]?.members[0]?.effective, "算_法");
		assert.equal(results.length, 0);
	});
});

describe("筛选条件", () => {
	test("只看入职前经历会排除仅有在职命中的人", async () => {
		const { results } = await search(parseChips("算法"), { kind: "external" });
		assert.ok(!results.some((r) => r.employee.empId === "T001"));
	});

	test("最短时长会滤掉短段", async () => {
		const { results } = await search(parseChips("算法"), { minMonths: 30 });
		assert.ok(results.some((r) => r.employee.empId === "T005"));
		const hit = results
			.find((r) => r.employee.empId === "T005")
			?.hits.find((h) => h.term === "算法");
		assert.equal(hit?.months, 36);
	});
});

/**
 * 筛选面板的候选与计数。
 *
 * 这组测试钉的是口径：左栏每一项后面的数是「选了它之后还剩多少**人**」，
 * 和中栏那句「命中 N 人」同一个单位，所以它必须和主检索用同一套 AND 语义。
 * 如果误计为经历段，左栏会远大于结果人数，两个数字互相拆台，
 * 还暗示"点它能得到 3009 人"。下面每一条都是在拦这个。
 */
describe("分面", () => {
	before(async () => {
		await seed([
			{
				empId: "F001",
				name: "分面甲",
				segments: [{ seqL1: "技术", seqL2: "算法", months: 36 }],
			},
			{
				empId: "F002",
				name: "分面乙",
				segments: [{ seqL1: "技术", seqL2: "算法", months: 36 }],
			},
			{
				empId: "F003",
				name: "分面丙",
				segments: [
					{ seqL1: "运营", seqL2: "渠道", title: "算法运维", months: 36 },
				],
			},
			{
				empId: "F004",
				name: "分面丁",
				segments: [
					{
						kind: "external",
						seqL1: "技术",
						seqL2: "算法",
						months: 36,
						companyTag: "头部互联网T1",
					},
				],
			},
		]);
	});

	const seqOf = (facets: Awaited<ReturnType<typeof search>>["facets"]) =>
		new Map(facets.seq.map((s) => [`${s.seqL1}/${s.seqL2}`, s.n]));

	test("数的是人，而且只数这一次检索里的人", async () => {
		const { facets } = await search(parseChips("算法"));
		// 全库还有别的人序列里写着算法，但他们没有 seq_l1，进不了这一维；
		// 关键是这个数不可能超过命中总人数
		assert.equal(seqOf(facets).get("技术/算法"), 3);
		assert.equal(seqOf(facets).get("运营/渠道"), 1);
	});

	test("口径和主检索一致：一个人要在这一项里凑齐全部概念词才算数", async () => {
		// F003 一段之内既有 title 算法又有 seq 渠道，两个词都落在「运营/渠道」里
		const { facets } = await search(parseChips("算法 渠道"));
		assert.equal(seqOf(facets).get("运营/渠道"), 1);
		// F001/F002 在「技术/算法」里凑不齐「渠道」，这一项一个人都不剩
		assert.equal(seqOf(facets).get("技术/算法"), undefined);
	});

	test("算某一维时要摘掉这一维自己的筛选，否则选中之后就切不动了", async () => {
		const { facets, results } = await search(parseChips("算法"), {
			seqL1: "技术",
			seqL2: "算法",
		});
		assert.equal(results.length, 3, "结果本身是被筛过的");
		// 但序列这一维的候选不受它自己影响，别的序列还看得见、点得动
		assert.equal(seqOf(facets).get("运营/渠道"), 1);
		assert.equal(seqOf(facets).get("技术/算法"), 3);
	});

	test("别的维度的筛选照常收窄候选", async () => {
		// 只看入职前：三个内部的人不再在任何序列里凑得齐
		const { facets } = await search(parseChips("算法"), { kind: "external" });
		assert.equal(seqOf(facets).get("技术/算法"), 1);
		assert.equal(seqOf(facets).get("运营/渠道"), undefined);
	});

	test("数不出人的选项根本不出现——左栏能变短靠的是这个", async () => {
		const { facets } = await search(parseChips("算法"));
		assert.ok(
			facets.seq.every((s) => s.n > 0),
			"计数为 0 的选项不该被送到界面上",
		);
		assert.ok(
			facets.companyTag.every((t) => t.value !== "" && t.value !== "未知"),
			"空档和未知档不是可点的筛选项",
		);
	});

	test("公司档与经历类型同样跟着查询走", async () => {
		const { facets } = await search(parseChips("算法"));
		assert.deepEqual(facets.companyTag, [{ value: "头部互联网T1", n: 1 }]);
		// F004 的入职前经历，加上 T003 那段简历原文里提到算法的入职前经历
		assert.equal(facets.kind.find((k) => k.value === "external")?.n, 2);
	});

	test("没有概念词就没有候选，不拿全库的数字充数", async () => {
		const { facets } = await search(parseChips("帮我找一下的人"));
		assert.deepEqual(facets.seq, []);
		assert.deepEqual(facets.minMonths, []);
	});
});

/**
 * 命中总数与「证据要求」。
 *
 * 这两件事同源，所以放在一起钉：顶上那句「命中 N 人」报的必须是截断**之前**
 * 的人数，不能是 `results.length`（那是已经翻出来的那几页有多长），
 * 否则同一屏上左栏 416、中栏 50，两个数互相拆台。同样地，「证据要求」
 * 必须落在 SQL 里，放到客户端它就只能筛那被截断的 50 个人。
 */
describe("命中总数", () => {
	before(async () => {
		await seed(
			Array.from({ length: 55 }, (_, i) => ({
				empId: `L${String(i).padStart(3, "0")}`,
				name: `批量${i}`,
				segments: [{ seqL1: "技术", seqL2: "潜航", months: 24 }],
			})),
		);
	});

	test("报的是截断之前的人数，不是那一页有多长", async () => {
		const { results, total } = await search(parseChips("潜航"));
		assert.equal(results.length, RESULT_PAGE, "结果本身仍然截断");
		assert.equal(total, 55, "总数必须说真话");
	});

	/**
	 * 翻页。
	 *
	 * 这里要钉住的不是「第二页能不能拉到」，而是**第二页是第一页的延长，不是
	 * 另一次排序**：分页靠把 limit 调大重查，所以前 50 名必须逐位不变。
	 * 一旦哪天改成 offset 续拉，这条会红——那正是它存在的理由。
	 */
	test("分面和总数是同一个口径，不会一个 55 一个 50", async () => {
		const { total, facets } = await search(parseChips("潜航"));
		const seq = facets.seq.find((s) => s.seqL2 === "潜航");
		assert.equal(seq?.n, total);
	});

	test("翻页只是把同一次排序拉得更长，不是重排", async () => {
		const first = await search(parseChips("潜航"), {}, RESULT_PAGE);
		const more = await search(parseChips("潜航"), {}, RESULT_PAGE * 2);
		assert.equal(more.results.length, 55, "第二页要把剩下的都带回来");
		assert.equal(more.total, first.total, "总数不因翻页而变");
		assert.deepEqual(
			more.results.slice(0, RESULT_PAGE).map((r) => r.employee.empId),
			first.results.map((r) => r.employee.empId),
			"前一页的人必须逐位不变，否则翻页会漏人或重复",
		);
	});

	test("要多少给多少，但不会超过命中的人数", async () => {
		const { results } = await search(parseChips("潜航"), {}, 10);
		assert.equal(results.length, 10);
		assert.equal(
			(await search(parseChips("潜航"), {}, 999)).results.length,
			55,
		);
	});
});

/**
 * `limit` 是唯一一个直接决定「拉多少行、序列化多大一份载荷」的入参，而服务端
 * 函数是个可以被直接调用的端点——所以它必须自己收窄，不能指望页面那侧的 URL 校验。
 */
describe("翻页上限", () => {
	test("非法值退回一页，不是退回 0", () => {
		for (const v of ["", "abc", "0", "-50", 0, -1, 12.5, null, undefined, {}]) {
			assert.equal(
				sanitizeLimit(v),
				RESULT_PAGE,
				`${JSON.stringify(v)} 该退回一页`,
			);
		}
	});

	test("再大也封在上限上", () => {
		assert.equal(sanitizeLimit(RESULT_MAX + 1), RESULT_MAX);
		assert.equal(sanitizeLimit(999999), RESULT_MAX);
		assert.equal(sanitizeLimit("100"), 100);
	});
});

describe("证据要求", () => {
	test("打开之后只剩每个词都有受控命中的人", async () => {
		const loose = await search(parseChips("算法 运营"));
		const strict = await search(parseChips("算法 运营"), { strong: true });
		const ids = strict.results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T001"), "序列 + 岗位命中，应当留下");
		assert.ok(!ids.includes("T003"), "两个词都只在简历原文里，应当被排除");
		assert.ok(strict.total < loose.total, "收窄之后总数必须变小");
	});

	test("左栏那一项的两头：打开还剩几个、关掉能看到几个", async () => {
		const { facets, total } = await search(parseChips("算法 运营"));
		assert.equal(facets.strong.off, total, "关掉就是当前全部");
		assert.equal(
			facets.strong.on,
			(await search(parseChips("算法 运营"), { strong: true })).total,
			"打开的预告数必须等于真打开之后的结果",
		);
	});

	test("它自己开着的时候，那一项的预告数不受自己影响", async () => {
		// 否则打开之后左栏显示的是「打开再打开一次」，用户看不出关掉能回到哪
		const on = await search(parseChips("算法 运营"), { strong: true });
		const off = await search(parseChips("算法 运营"));
		assert.equal(on.facets.strong.off, off.total);
		assert.equal(on.facets.strong.on, off.facets.strong.on);
	});
});

describe("加分词", () => {
	test("不命中也留在结果里——这正是它和必须词的区别", async () => {
		// 「算法」必须，「运营」加分：T002 只有算法，必须留下
		const { results } = await search(parseChips("算法,+运营"));
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T002"), "只命中必须词的人不该被加分词淘汰");
		assert.ok(ids.includes("T001"), "两个都命中的人当然也在");
	});

	test("命中了就往上抬，抬到只命中必须词的人前面", async () => {
		const { results } = await search(parseChips("算法,+运营"));
		const rank = results.map((r) => r.employee.empId);
		// T001 与 T002 的「算法」都是满 36 个月的受控命中，必须词那一半打平；
		// 差别只在 T001 还命中了加分词。名次因此只能由加分项决定。
		assert.ok(
			rank.indexOf("T001") < rank.indexOf("T002"),
			"命中加分词的人应当排在前面",
		);
	});

	test("加分只抬不压：命中的词越少，分不会反而越高", async () => {
		const { results } = await search(parseChips("算法,+运营"));
		const t001 = results.find((r) => r.employee.empId === "T001");
		const t002 = results.find((r) => r.employee.empId === "T002");
		assert.ok(t001 && t002);
		assert.ok(
			t001.score > t002.score,
			`命中两个词的分(${t001.score})必须高于只命中一个的(${t002.score})`,
		);
	});

	test("整句都是加分词时退化成 OR：命中任意一个就算数", async () => {
		const { results } = await search(parseChips("+算法,+运营"));
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T002"), "只有算法");
		assert.ok(ids.includes("T006"), "只有渠道运营");
	});

	test("分面口径跟着走：加分词不参与「还剩几人」的计算", async () => {
		const { facets, total } = await search(parseChips("算法,+运营"));
		assert.equal(facets.strong.off, total, "关掉证据要求就是当前全部");
	});
});

describe("排除词：否决证据段，不否决人", () => {
	test("命中排除词的段丧失作证资格；只有这类证据的人自然出局", async () => {
		// T003 唯一的「算法」证据在一段同时写着「运营支持」的简历原文上：
		// 那一段被「-运营」否决之后，他没有证据了，过不了 AND。
		const loose = await search(parseChips("算法"));
		const tight = await search(parseChips("算法,-运营"));
		const ids = tight.results.map((r) => r.employee.empId);
		assert.ok(
			loose.results.some((r) => r.employee.empId === "T003"),
			"不排除时 T003 在结果里",
		);
		assert.ok(!ids.includes("T003"), "唯一证据被否决的人应当出局");
	});

	test("别的段还有证据的人留下——排除砍的是证据，不是人", async () => {
		// T001 的「算法」证据在序列段上，被否决的是他那段「运营专员」经历。
		// 人级排除会把这种人整个剔掉，违背「排除只否决证据段」的语义。
		const { results } = await search(parseChips("算法,-运营"));
		const t001 = results.find((r) => r.employee.empId === "T001");
		assert.ok(t001, "有独立算法证据的人不因一段运营经历被整个排掉");
		assert.ok(
			t001.hits.every((h) => h.title !== "运营专员"),
			"被否决的段也不能再出现在证据行里",
		);
	});

	test("总数与分面跟着一起减，不会出现「点了还剩 N 人」点下去不是 N", async () => {
		const tight = await search(parseChips("算法,-运营"));
		assert.equal(
			tight.facets.strong.off,
			tight.total,
			"分面的口径必须和结果同一个",
		);
		assert.equal(tight.total, tight.results.length);
	});

	test("排除词不占列：它不产出证据，表格里没有它的位置", async () => {
		const { terms } = await search(parseChips("算法,-运营"));
		assert.deepEqual(
			terms.map((t) => t.term),
			["算法"],
		);
	});

	test("整句只有排除词时不返回任何人——它只会剔人，不会捞人", async () => {
		const { terms, results } = await search(parseChips("-算法"));
		assert.equal(terms.length, 0);
		assert.equal(results.length, 0);
	});

	test("语料里没有的排除词谁都排不掉，不做子串退让", async () => {
		// 松弛用在排除上是一把没瞄准的枪：「量子炼金」退成「金」会把干过
		// 「资金」「基金」的人整片剔掉，而界面上只显示用户写的那个词。
		const plain = await search(parseChips("算法"));
		const withExclude = await search(parseChips("算法,-量子炼金"));
		assert.equal(withExclude.total, plain.total);
	});
});

/**
 * 停用的词。
 *
 * 语义上它必须**彻底不存在**：不收窄、不排人、不占列、不进分面。任何一处
 * 漏掉都不会报错，只会让「我把这个条件关掉了」和实际结果对不上——而这正是
 * 停用这个功能存在的意义（关掉它看看还剩谁），对不上就等于没有这个功能。
 */
describe("停用的词", () => {
	test("停用一个必须词，结果和根本没写它一样", async () => {
		const only = await search(parseChips("算法"));
		const withOff = await search(parseChips("算法,~运营"));
		assert.equal(withOff.total, only.total);
		assert.deepEqual(
			withOff.results.map((r) => r.employee.empId),
			only.results.map((r) => r.employee.empId),
		);
	});

	test("停用的词不占列：表格里没有它的位置", async () => {
		const { terms } = await search(parseChips("算法,~运营"));
		assert.deepEqual(
			terms.map((t) => t.term),
			["算法"],
		);
	});

	test("停用一个排除词，被它排掉的人回来了", async () => {
		const excluded = await search(parseChips("算法,-运营"));
		const off = await search(parseChips("算法,~-运营"));
		assert.ok(off.total > excluded.total, "停用排除词必须放人回来");
		assert.equal(off.total, (await search(parseChips("算法"))).total);
	});

	test("分面跟着走：停用的词不参与「还剩几人」", async () => {
		const off = await search(parseChips("算法,~运营"));
		const only = await search(parseChips("算法"));
		assert.deepEqual(off.facets.seq, only.facets.seq);
		assert.equal(off.facets.strong.off, only.facets.strong.off);
	});

	test("全停用了就没有可排的人——和空查询同一个结果", async () => {
		const { terms, results, total } = await search(parseChips("~算法,~运营"));
		assert.deepEqual(terms, []);
		assert.deepEqual(results, []);
		assert.equal(total, 0);
	});
});

/**
 * 零态的语料概览。
 *
 * 它给出的每一个方向都是一个**入口**：点下去就是一次检索。所以这里钉的不是
 * 「查询跑不跑得动」，而是「这些入口落不落得到人」——一个点下去得到零结果、
 * 或者被切词切成两半的入口，比不给这个入口更糟，而这两种坏法在页面上都
 * 看不出来（词还在那儿，只是结果不对）。
 */
describe("零态的语料概览", () => {
	before(async () => {
		await seed([
			{
				empId: "V001",
				name: "带连接词的序列",
				// 「与」是 parseQuery 的分隔符：这个序列名当概念词会被切成两半，
				// 所以它一定不能出现在零态的词汇表里。
				segments: [{ seqL1: "安全", seqL2: "安全与风险合规", months: 24 }],
			},
		]);
	});

	test("规模数的是人和段", async () => {
		const o = await overview();
		assert.ok(o.people > 0);
		assert.ok(o.segments >= o.people, "段数不可能少于人数");
	});

	test("每个方向都搜得到人，而且原样就是一个概念词", async () => {
		const o = await overview();
		assert.ok(o.seqs.length > 0, "有语料就该给得出方向");
		for (const seq of o.seqs) {
			const { terms, total } = await search(parseChips(seq));
			assert.deepEqual(
				terms.map((t) => t.term),
				[seq],
				`「${seq}」点下去被切词切走了`,
			);
			assert.ok(total > 0, `「${seq}」点下去一个人都没有`);
		}
	});

	test("会被切词切走的序列名不出现在词汇表里", async () => {
		const o = await overview();
		assert.ok(!o.seqs.includes("安全与风险合规"));
	});
});

/**
 * 一条要求的多个说法。
 *
 * 说法之间是 OR、要求之间仍是 AND；near 说法降档计分（FORM_WEIGHTS）。
 * 打分公式在 rank.test.ts 里钉死，这里验的是取数层：每个说法各自取事实、
 * 档位与「命中的是哪个说法」原样到达打分层与证据行。
 */
describe("一条要求的多个说法", () => {
	before(async () => {
		await seed([
			{
				empId: "M001",
				name: "只有相近说法命中",
				segments: [{ seqL2: "深度学习", months: 36 }],
			},
			{
				empId: "M002",
				name: "原词命中",
				segments: [{ seqL2: "机甲算法", months: 36 }],
			},
			{
				empId: "M003",
				name: "另一段命中排除的第二个说法",
				segments: [
					{ seqL2: "机甲算法", months: 36 },
					{ seqL2: "下棋", months: 12 },
				],
			},
			{
				empId: "M004",
				name: "同一段命中两个说法",
				segments: [{ seqL2: "机甲算法与深度学习", months: 12 }],
			},
			{
				empId: "M005",
				name: "相近说法命中更硬字段",
				segments: [{ org: "机甲算法部门", seqL2: "深度学习", months: 12 }],
			},
		]);
	});

	test("并列说法满足其一即满足要求，不会拆成两条都要", async () => {
		const { terms, results } = await search(parseChips("机甲算法/深度学习"));
		assert.equal(terms.length, 1, "一条要求，不是两条");
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("M001") && ids.includes("M002"));
	});

	test("near 说法捞得到人，但同等条件下排在原词命中之后", async () => {
		const { results } = await search(parseChips("机甲算法/?深度学习"));
		const rank = results.map((r) => r.employee.empId);
		assert.ok(rank.includes("M001"), "相近说法必须能捞到人");
		assert.ok(
			rank.indexOf("M002") < rank.indexOf("M001"),
			"两人月数相同且都是序列命中，原词档必须在前",
		);
	});

	test("证据行说出实际命中的说法，而不是要求的主词", async () => {
		const { results } = await search(parseChips("机甲算法/?深度学习"));
		const m1 = results.find((r) => r.employee.empId === "M001");
		assert.equal(m1?.hits[0]?.term, "机甲算法", "行归属仍是这条要求");
		assert.equal(m1?.hits[0]?.matched, "深度学习", "但命中的字必须如实说");
	});

	test("同一段命中同一要求的两个说法，只贡献一次", async () => {
		// 说法之间是 OR，不是两条证据：不去重的话 termValue 会把这 12 个月
		// 累加成 24，分数、展示的累计月数、证据行全跟着说谎。
		const { results } = await search(parseChips("机甲算法/深度学习"));
		const m4 = results.find((r) => r.employee.empId === "M004");
		assert.equal(m4?.basis[0]?.months, 12, "月份只能计一次");
		assert.equal(m4?.hits.length, 1, "证据行只列这一段一次");
	});

	test("同段并中 full 与 near 时留下的是更硬的 full 说法", async () => {
		const { results } = await search(parseChips("机甲算法/?深度学习"));
		const m4 = results.find((r) => r.employee.empId === "M004");
		assert.equal(m4?.hits[0]?.matched, "机甲算法");
	});

	test("说法档位与字段强度一起决定同段留下哪一次命中", async () => {
		const { results } = await search(parseChips("机甲算法/?深度学习"));
		const m5 = results.find((r) => r.employee.empId === "M005");
		assert.equal(m5?.hits[0]?.matched, "深度学习");
		assert.equal(m5?.hits[0]?.route, "seq");
	});

	test("排除组的说法取并集，但仍然只否决段", async () => {
		const { results } = await search(parseChips("机甲算法,-机甲拳击/下棋"));
		const ids = results.map((r) => r.employee.empId);
		// M003 的「下棋」段被第二个说法否决，但他的「机甲算法」证据无恙
		assert.ok(ids.includes("M003"), "无关段被否决不影响这个人");
		const m3 = results.find((r) => r.employee.empId === "M003");
		assert.ok(m3?.hits.every((h) => h.seq !== "下棋"));
	});
});
