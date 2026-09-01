/**
 * 打分与排序。**不连数据库**，全部语义以纯函数方式验证。
 *
 * 这里钉的是「一份事实应该排出什么名次」；「事实本身对不对」是 search.test.ts
 * 的事，两边不重叠。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type Fact, gapMonths, pageHits, rank } from "#/search/rank";
import type { SearchFilters, TermPlan } from "#/search/result";
import {
	FORM_WEIGHTS,
	RECENCY_FLOOR,
	ROUTE_WEIGHTS,
	TENURE_FLOOR,
} from "#/search/weights";

/** 钉死的「今天」：近因因子让分数依赖当前时间，测试不能跟着日历漂 */
const NOW = new Date(2026, 0, 1);

let nextId = 1;
function fact(p: Partial<Fact> & { empId: string }): Fact {
	return {
		id: nextId++,
		termIdx: 0,
		memberIdx: 0,
		tier: "full",
		route: "seq",
		months: 24,
		endDate: null,
		seqL1: "技术",
		seqL2: "算法",
		companyTag: null,
		kind: "internal",
		...p,
	};
}

const terms = (...modes: TermPlan["mode"][]): TermPlan[] =>
	modes.map((mode, i) => ({
		term: `词${i}`,
		members: [{ text: `词${i}`, effective: `词${i}`, tier: "full" }],
		mode,
	}));

const run = (facts: Fact[], t = terms("must"), f: SearchFilters = {}) =>
	rank(facts, t, f, NOW);

const scoreOf = (facts: Fact[], t?: TermPlan[], f?: SearchFilters) => {
	const { ranked } = run(facts, t, f);
	return ranked[0]?.score ?? 0;
};

/** 若干年前结束的一段：近因因子据此衰减 */
const yearsAgo = (n: number) => `${NOW.getFullYear() - n}-01-01`;

describe("证据强度不可被时长或近因压过", () => {
	/*
	 * 这是整套权重的地基：ROUTE_WEIGHTS 论证了「序列是 HR 登记的归属，部门只说明
	 * 他在那个组织里，简历原文提到不等于做过」。时长和近因是**同一档证据内部**的
	 * 分辨率，一旦它们的量程盖过档与档之间的差，那套论证就被算法推翻了。
	 */
	test("干了二十年且还在做的部门命中，压不过一段刚开始的序列命中", () => {
		const org = scoreOf([fact({ empId: "A", route: "org", months: 240 })]);
		const seq = scoreOf([
			fact({ empId: "B", route: "seq", months: 1, endDate: yearsAgo(30) }),
		]);
		assert.ok(seq > org, `序列 ${seq} 必须高于部门 ${org}`);
	});

	test("简历原文同理，压不过任何受控命中", () => {
		const desc = scoreOf([
			fact({ empId: "A", route: "description", months: 240 }),
		]);
		const org = scoreOf([
			fact({ empId: "B", route: "org", months: 1, endDate: yearsAgo(30) }),
		]);
		assert.ok(org > desc);
	});

	test("两个地板的乘积必须大于相邻路权重的比值，否则上面两条迟早会红", () => {
		// 把常数本身也钉住：改地板的人不一定会去跑上面那两条的边界值
		const weights = Object.values(ROUTE_WEIGHTS).sort((a, b) => b - a);
		const worst = Math.min(
			...weights.slice(1).map((w, i) => w / (weights[i] as number)),
		);
		assert.ok(
			TENURE_FLOOR * RECENCY_FLOOR > worst,
			`地板乘积 ${TENURE_FLOOR * RECENCY_FLOOR} 必须大于 ${worst}`,
		);
	});
});

describe("时长", () => {
	test("累计，不是取最长的一段", () => {
		const split = scoreOf([
			fact({ empId: "A", months: 24 }),
			fact({ empId: "A", months: 24 }),
		]);
		const single = scoreOf([fact({ empId: "B", months: 24 })]);
		assert.ok(split > single, "两段 24 个月必须高于一段 24 个月");
	});

	test("没有封顶线，三年以上仍然分得开", () => {
		const a = scoreOf([fact({ empId: "A", months: 36 })]);
		const b = scoreOf([fact({ empId: "B", months: 120 })]);
		const c = scoreOf([fact({ empId: "C", months: 240 })]);
		assert.ok(a < b && b < c, `${a} < ${b} < ${c}`);
	});

	test("有界：再长也到不了满分，长经历不会碾压一切", () => {
		const huge = scoreOf([fact({ empId: "A", months: 100_000 })]);
		assert.ok(huge < ROUTE_WEIGHTS.seq, `${huge} 必须小于路权重本身`);
	});

	test("有地板：一段很短的经历不归零", () => {
		const tiny = scoreOf([fact({ empId: "A", months: 1 })]);
		assert.ok(tiny >= ROUTE_WEIGHTS.seq * TENURE_FLOOR * 0.999);
	});
});

describe("近因", () => {
	test("日期按日历年月计算，不受 UTC 日期在负时区回退一天影响", () => {
		const previous = process.env.TZ;
		process.env.TZ = "America/Los_Angeles";
		try {
			assert.equal(gapMonths("2025-01-01", new Date(2026, 0, 1)), 12);
		} finally {
			if (previous === undefined) delete process.env.TZ;
			else process.env.TZ = previous;
		}
	});

	test("还在做的高于早就不做的", () => {
		const now = scoreOf([fact({ empId: "A" })]);
		const old = scoreOf([fact({ empId: "B", endDate: yearsAgo(3) })]);
		assert.ok(now > old);
	});

	test("越久越低，但有地板——五年前干过也还是干过", () => {
		const three = scoreOf([fact({ empId: "A", endDate: yearsAgo(3) })]);
		const ten = scoreOf([fact({ empId: "B", endDate: yearsAgo(10) })]);
		const ancient = scoreOf([fact({ empId: "C", endDate: yearsAgo(40) })]);
		assert.ok(three > ten && ten > ancient);
		assert.ok(ancient > ROUTE_WEIGHTS.seq * TENURE_FLOOR * RECENCY_FLOOR * 0.9);
	});

	test("多段里取最近的那一段：回到这个方向就算还在做", () => {
		const back = scoreOf([
			fact({ empId: "A", months: 12, endDate: yearsAgo(10) }),
			fact({ empId: "A", months: 12 }),
		]);
		const gone = scoreOf([
			fact({ empId: "B", months: 12, endDate: yearsAgo(10) }),
			fact({ empId: "B", months: 12, endDate: yearsAgo(9) }),
		]);
		assert.ok(back > gone);
	});
});

describe("排名依据", () => {
	test("逐词依据保留实际参与打分的累计时长与最近时间", () => {
		const facts = [
			fact({ empId: "A", months: 60, endDate: "2019-01-01" }),
			fact({ empId: "A", months: 48, endDate: "2020-01-01" }),
			fact({ empId: "A", months: 36, endDate: "2021-01-01" }),
			fact({ empId: "A", months: 1, endDate: null }),
		];
		const { ranked } = run(facts);
		assert.deepEqual(ranked[0]?.basis, [
			{
				term: "词0",
				routes: ["seq"],
				months: 145,
				endDate: null,
				external: false,
			},
		]);

		const shown = pageHits(facts, {}, new Set(["A"]), 3).get("A") ?? [];
		assert.equal(shown.length, 3, "时间线只需保留有限条原始命中");
		assert.ok(
			shown.every((item) => item.endDate !== null),
			"聚合依据不能再从截断后的原始命中反推",
		);
	});

	test("没有命中的加分词保留空依据", () => {
		const { ranked } = run(
			[fact({ empId: "A", termIdx: 0 })],
			terms("must", "boost"),
		);
		assert.deepEqual(ranked[0]?.basis, [
			{
				term: "词0",
				routes: ["seq"],
				months: 24,
				endDate: null,
				external: false,
			},
			null,
		]);
	});

	test("并列最强的序列与岗位共同累计，并在依据里同时说明", () => {
		const { ranked } = run([
			fact({ empId: "A", route: "seq", months: 12 }),
			fact({ empId: "A", route: "title", months: 18 }),
			fact({ empId: "A", route: "org", months: 60 }),
		]);
		assert.deepEqual(ranked[0]?.basis, [
			{
				term: "词0",
				routes: ["seq", "title"],
				months: 30,
				endDate: null,
				external: false,
			},
		]);
	});

	/**
	 * 表格那一格显示的是累计值，「前」这个前缀因此不能由某一段的 kind 决定。
	 * 判定必须和累计发生在同一个循环里，否则一个跨了在职与入职前的累计
	 * 会被贴上只描述其中一半的标签。
	 */
	test("累计横跨在职与入职前时，依据里不算「入职前」", () => {
		const mixed = run([
			fact({ empId: "A", kind: "external", months: 24 }),
			fact({ empId: "A", kind: "internal", months: 12 }),
		]);
		assert.equal(mixed.ranked[0]?.basis[0]?.external, false);

		const pure = run([
			fact({ empId: "A", kind: "external", months: 24 }),
			fact({ empId: "A", kind: "external", months: 12 }),
		]);
		assert.equal(pure.ranked[0]?.basis[0]?.external, true);
	});

	test("被强度挡掉的段不参与「入职前」判定，和时长口径一致", () => {
		// 序列命中全在入职前，简历里那一段在职——后者根本不参与累计
		const { ranked } = run([
			fact({ empId: "A", route: "seq", kind: "external", months: 24 }),
			fact({
				empId: "A",
				route: "description",
				kind: "internal",
				months: 240,
			}),
		]);
		assert.equal(ranked[0]?.basis[0]?.external, true);
		assert.equal(ranked[0]?.basis[0]?.months, 24);
	});
});

describe("说法的档位（字眼档位 × 路权重）", () => {
	test("同一路上，相近说法的命中低于原词命中", () => {
		const full = scoreOf([fact({ empId: "A" })]);
		const near = scoreOf([fact({ empId: "B", tier: "near", memberIdx: 1 })]);
		assert.ok(near < full);
		assert.ok(near > 0, "降档不是不算");
	});

	test("相近说法的受控命中，基础强度高于原词的部门命中", () => {
		// 登记字段说他真在干这个，词的距离只是翻译损耗——方向见 weights.ts
		assert.ok(FORM_WEIGHTS.near * ROUTE_WEIGHTS.seq > ROUTE_WEIGHTS.org);
	});

	test("时长与近因只跟着最硬那条证据：原词命中在场时，相近命中不续时长", () => {
		const mixed = scoreOf([
			fact({ empId: "A", months: 12 }),
			fact({ empId: "A", tier: "near", memberIdx: 1, months: 240 }),
		]);
		const clean = scoreOf([fact({ empId: "B", months: 12 })]);
		assert.equal(mixed, clean);
	});

	test("证据要求看的是路（受控字段），与说法档位正交", () => {
		const facts = [fact({ empId: "A", tier: "near", memberIdx: 1 })];
		assert.equal(run(facts, terms("must"), { strong: true }).total, 1);
	});
});

describe("时长与近因只算最硬那一路的段", () => {
	test("简历里提过一句，不给序列命中续时长", () => {
		const mixed = scoreOf([
			fact({ empId: "A", route: "seq", months: 12 }),
			fact({ empId: "A", route: "description", months: 240 }),
		]);
		const clean = scoreOf([fact({ empId: "B", route: "seq", months: 12 })]);
		assert.equal(
			mixed,
			clean,
			"弱证据段不该改变强证据的时长——那是把两档证据混成一份",
		);
	});
});

describe("必须、加分与证据要求", () => {
	const two = terms("must", "must");

	test("缺一个必须词就整个不算数", () => {
		const { ranked } = run(
			[fact({ empId: "A", termIdx: 0 }), fact({ empId: "B", termIdx: 1 })],
			two,
		);
		assert.deepEqual(
			ranked.map((r) => r.empId),
			[],
			"两个人各命中一个词，AND 语义下一个都不该留",
		);
	});

	test("必须词之间是乘积：一个词弱，整个人被压下去", () => {
		const strong = scoreOf(
			[
				fact({ empId: "A", termIdx: 0 }),
				fact({ empId: "A", termIdx: 1, route: "seq" }),
			],
			two,
		);
		const weak = scoreOf(
			[
				fact({ empId: "B", termIdx: 0 }),
				fact({ empId: "B", termIdx: 1, route: "description" }),
			],
			two,
		);
		assert.ok(strong > weak);
	});

	test("加分词不命中也留下，命中就往上抬", () => {
		const t = terms("must", "boost");
		const { ranked } = run(
			[
				fact({ empId: "A", termIdx: 0 }),
				fact({ empId: "A", termIdx: 1 }),
				fact({ empId: "B", termIdx: 0 }),
			],
			t,
		);
		assert.deepEqual(
			ranked.map((r) => r.empId),
			["A", "B"],
			"命中加分词的人在前，没命中的仍然在结果里",
		);
	});

	test("证据要求只管必须词，且要求每个必须词都有受控命中", () => {
		const facts = [
			fact({ empId: "A", termIdx: 0, route: "seq" }),
			fact({ empId: "B", termIdx: 0, route: "description" }),
		];
		assert.deepEqual(
			run(facts, terms("must"), { strong: true }).ranked.map((r) => r.empId),
			["A"],
		);
		assert.equal(run(facts).total, 2, "关掉之后两个人都在");
	});
});

describe("分面与名次是同一个口径", () => {
	const facts = [
		fact({ empId: "A", seqL1: "技术", seqL2: "算法" }),
		fact({ empId: "B", seqL1: "技术", seqL2: "算法" }),
		fact({ empId: "C", seqL1: "运营", seqL2: "渠道" }),
	];

	test("分面数的是这次检索里的人，加起来对得上总数", () => {
		const { facets, total } = run(facts);
		assert.equal(total, 3);
		assert.equal(facets.seq.find((s) => s.seqL2 === "算法")?.n, 2);
		assert.equal(facets.strong.off, total, "关掉证据要求就是当前全部");
	});

	test("算某一维时摘掉这一维自己的筛选，否则选中之后就切不动了", () => {
		const { facets, total } = run(facts, terms("must"), {
			seqL1: "技术",
			seqL2: "算法",
		});
		assert.equal(total, 2, "结果本身是被筛过的");
		assert.equal(
			facets.seq.find((s) => s.seqL2 === "渠道")?.n,
			1,
			"别的序列还得看得见、点得动",
		);
	});

	test("算不出人的选项根本不出现", () => {
		const { facets } = run(facts);
		assert.ok(facets.seq.every((s) => s.n > 0));
	});
});

describe("同分的顺序是确定的", () => {
	/*
	 * 翻页靠把 limit 调大重查，所以前一页必须逐位不变。分数相同时若不定序，
	 * 第二页会漏人或让人重复出现，而界面上看不出来。
	 */
	test("同分按工号，两次求值结果一致", () => {
		const facts = ["C", "A", "B"].map((empId) => fact({ empId }));
		const once = run(facts).ranked.map((r) => r.empId);
		const twice = run([...facts].reverse()).ranked.map((r) => r.empId);
		assert.deepEqual(once, ["A", "B", "C"]);
		assert.deepEqual(twice, once);
	});
});
