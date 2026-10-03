/**
 * 打分与排序。**不连数据库**，全部语义以纯函数方式验证。
 *
 * 这里测的是「一份事实应该排出什么名次」；「事实本身对不对」是 search.test.ts
 * 的事，两边不重叠。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SearchFilters } from "#/search/params";
import {
	type Fact,
	gapMonths,
	pageHits,
	rank,
	rankPopulation,
} from "#/search/rank";
import type { Claim } from "#/search/result";
import { BOOST_WEIGHT, RELEVANCE_MIN } from "#/search/weights";
import { claim } from "./conditions";

/** 固定的「今天」：近因因子让分数依赖当前时间，测试不能跟着日历漂 */
const NOW = new Date(2026, 0, 1);

let nextId = 1;
function fact(p: Partial<Fact> & { empId: string }): Fact {
	return {
		id: nextId++,
		claim: 0,
		value: "词0",
		route: "role",
		relevance: 1,
		phrase: null,
		involvement: null,
		months: 24,
		endDate: null,
		seqL1: "技术",
		seqL2: "算法",
		companyTag: null,
		skills: [],
		kind: "internal",
		level: "",
		levelRank: null,
		recruitment: "",
		education: "",
		educationRank: null,
		...p,
	};
}

const claims = (...modes: Claim["mode"][]): Claim[] =>
	modes.map((mode, i) => claim(`词${i}`, { mode }) as Claim);

const run = (facts: Fact[], t = claims("must"), f: SearchFilters = {}) =>
	rank(facts, t, f, NOW);

/** 排在最前的那个人的深度。 */
const depthOf = (facts: Fact[], t?: Claim[], f?: SearchFilters) => {
	const { ranked } = run(facts, t, f);
	return ranked[0]?.depth ?? 0;
};

/** 名次：工号按先后。 */
const orderOf = (facts: Fact[], t?: Claim[], f?: SearchFilters) =>
	run(facts, t, f).ranked.map((r) => r.empId);

/** 若干年前结束的一段：近因因子据此衰减 */
const yearsAgo = (n: number) => `${NOW.getFullYear() - n}-01-01`;

describe("名次只看深度，来源不参与", () => {
	/*
	 * 任职记录和简历里写的都在说这个人做过什么。按来源分档的话，一条勉强对得上的
	 * 任职记录会压过一段做了二十年、对得很准的经历；来源写在证据行上，由 HR 判断。
	 */
	test("深度一样时，来源不同深度也一样", () => {
		const role = depthOf([fact({ empId: "A", route: "role" })]);
		const skill = depthOf([fact({ empId: "A", route: "skill" })]);
		const raw = depthOf([fact({ empId: "A", route: "description" })]);
		assert.equal(role, skill);
		assert.equal(role, raw);
	});

	test("简历里做了很久、对得很准的，排在一条勉强对得上、早已离开的任职记录前面", () => {
		assert.deepEqual(
			orderOf([
				fact({
					empId: "A",
					route: "role",
					relevance: RELEVANCE_MIN,
					months: 6,
					endDate: yearsAgo(10),
				}),
				fact({ empId: "B", route: "skill", relevance: 0.95, months: 96 }),
			]),
			["B", "A"],
		);
	});
});

/** 一条主张的几个经历词同权：靠哪个词命中只进证据行，不进分。 */
describe("取值", () => {
	test("同一段原文，靠哪个取值命中深度都一样", () => {
		const first = depthOf([fact({ empId: "A", value: "词0" })]);
		const other = depthOf([fact({ empId: "A", value: "别的取值" })]);
		assert.equal(first, other);
	});

	test("同一段几个取值都命中时取最强的那条，不叠加", () => {
		const both = depthOf([
			fact({ empId: "A", id: 7, value: "词0" }),
			fact({ empId: "A", id: 7, value: "别的取值", relevance: 0.8 }),
		]);
		const one = depthOf([fact({ empId: "A", id: 7, value: "词0" })]);
		// 同段两行本该在取数 SQL 里就去重掉（search.ts 的 factsSql），
		// 这里只保证万一漏到内存里，相关度按最高的那条算，月份也不因此翻倍。
		assert.equal(both, one);
	});
});

describe("时长", () => {
	test("累计，不是取最长的一段", () => {
		const split = depthOf([
			fact({ empId: "A", months: 24 }),
			fact({ empId: "A", months: 24 }),
		]);
		const single = depthOf([fact({ empId: "B", months: 24 })]);
		assert.ok(split > single, "两段 24 个月必须高于一段 24 个月");
	});

	test("没有封顶线，三年以上仍然分得开", () => {
		const a = depthOf([fact({ empId: "A", months: 36 })]);
		const b = depthOf([fact({ empId: "B", months: 120 })]);
		const c = depthOf([fact({ empId: "C", months: 240 })]);
		assert.ok(a < b && b < c, `${a} < ${b} < ${c}`);
	});

	test("有界：再长也到不了满分，长经历不会碾压一切", () => {
		const huge = depthOf([fact({ empId: "A", months: 100_000 })]);
		assert.ok(huge < 1, `${huge} 必须小于 1`);
	});

	test("取值范围放满：三个月和八年分得开", () => {
		const short = depthOf([fact({ empId: "A", months: 3 })]);
		const long = depthOf([fact({ empId: "B", months: 96 })]);
		assert.ok(long > short * 5, `${long} 对 ${short}：时长不该只是装饰`);
		assert.ok(short > 0, "很短的经历也不归零");
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

	test("无效日期不当成仍在职", () => {
		assert.throws(() => gapMonths("not-a-date", NOW), /无效结束日期/);
	});

	test("还在做的高于早就不做的", () => {
		const now = depthOf([fact({ empId: "A" })]);
		const old = depthOf([fact({ empId: "B", endDate: yearsAgo(3) })]);
		assert.ok(now > old);
	});

	test("越久越低，但不归零——四十年前干过也还是干过", () => {
		const three = depthOf([fact({ empId: "A", endDate: yearsAgo(3) })]);
		const ten = depthOf([fact({ empId: "B", endDate: yearsAgo(10) })]);
		const ancient = depthOf([fact({ empId: "C", endDate: yearsAgo(40) })]);
		assert.ok(three > ten && ten > ancient);
		assert.ok(ancient > 0);
	});

	test("多段里取最近的那一段：回到这个方向就算还在做", () => {
		const back = depthOf([
			fact({ empId: "A", months: 12, endDate: yearsAgo(10) }),
			fact({ empId: "A", months: 12 }),
		]);
		const gone = depthOf([
			fact({ empId: "B", months: 12, endDate: yearsAgo(10) }),
			fact({ empId: "B", months: 12, endDate: yearsAgo(9) }),
		]);
		assert.ok(back > gone);
	});
});

describe("人的偏好", () => {
	test("满足的人每条各乘一次加分的份量，不满足的什么都不乘", () => {
		const facts = [fact({ empId: "A" }), fact({ empId: "B" })];
		const plain = run(facts).ranked;
		const { ranked } = rank(facts, claims("must"), {}, NOW, [
			new Set(["B"]),
			new Set(["A", "B"]),
		]);
		assert.equal(ranked[0]?.empId, "B");
		assert.equal(ranked[1]?.empId, "A");
		// 「最好字节来的」和「最好是硕士」各是一条：满足一条得一条的分
		assert.equal(ranked[1]?.depth, (plain[0]?.depth ?? 0) * (1 + BOOST_WEIGHT));
		assert.equal(
			ranked[0]?.depth,
			(plain[0]?.depth ?? 0) * (1 + BOOST_WEIGHT) ** 2,
		);
	});
});

describe("累计时长的门槛", () => {
	const three: Claim = {
		about: "experience",
		mode: "must",
		what: ["词0"],
		minMonths: 36,
	};

	test("判的是累计：两段各二十个月的人过得了三年，一段二十个月的过不了", () => {
		const facts = [
			fact({ empId: "A", months: 20 }),
			fact({ empId: "A", months: 20 }),
			fact({ empId: "B", months: 20 }),
		];
		assert.deepEqual(
			run(facts, [three]).ranked.map((r) => r.empId),
			["A"],
		);
	});

	test("加分的主张不够时长就不加分，人还在；依据和证据段也不留", () => {
		const facts = [
			fact({ empId: "A", claim: 0 }),
			fact({ empId: "A", claim: 1, months: 12 }),
			fact({ empId: "B", claim: 0 }),
		];
		const list: Claim[] = [
			claims("must")[0] as Claim,
			{ ...three, mode: "boost" },
		];
		const { ranked } = run(facts, list);
		assert.equal(ranked.length, 2);
		assert.equal(
			ranked[0]?.depth,
			ranked[1]?.depth,
			"十二个月够不上三年，A 不该被抬",
		);
		// 名次里没有它，证据行上就不能有它：留一条「+ 词0 · 1 年」画成命中，
		// 读者会问为什么它没把 A 排到前面
		assert.equal(ranked.find((r) => r.empId === "A")?.basis[1], null);
		const shown = pageHits(facts, list, {}, new Set(["A"]), 3).get("A") ?? [];
		assert.deepEqual(
			shown.map((f) => f.claim),
			[0],
		);
	});
});

describe("排名依据", () => {
	test("逐条主张的依据保留实际参与打分的累计时长与最近时间", () => {
		const facts = [
			fact({ empId: "A", months: 60, endDate: "2019-01-01" }),
			fact({ empId: "A", months: 48, endDate: "2020-01-01" }),
			fact({ empId: "A", months: 36, endDate: "2021-01-01" }),
			fact({ empId: "A", months: 1, endDate: null }),
		];
		const { ranked } = run(facts);
		assert.deepEqual(ranked[0]?.basis, [
			{
				route: "role",
				value: "词0",
				relevance: 1,
				months: 145,
				endDate: null,
				external: false,
			},
		]);

		const shown =
			pageHits(facts, claims("must"), {}, new Set(["A"]), 3).get("A") ?? [];
		assert.equal(shown.length, 3, "时间线只需保留有限条原始命中");
		assert.ok(
			shown.every((item) => item.endDate !== null),
			"聚合依据不能再从截断后的原始命中反推",
		);
	});

	test("没有命中的加分主张保留空依据", () => {
		const { ranked } = run(
			[fact({ empId: "A", claim: 0 })],
			claims("must", "boost"),
		);
		assert.deepEqual(ranked[0]?.basis, [
			{
				route: "role",
				value: "词0",
				relevance: 1,
				months: 24,
				endDate: null,
				external: false,
			},
			null,
		]);
	});

	test("全部证据段共同累计，不分哪一类：一段简历里提过的算法经历也是算法经历", () => {
		const { ranked } = run([
			fact({ empId: "A", route: "role", months: 12 }),
			fact({ empId: "A", route: "title", months: 18, relevance: 0.9 }),
			fact({ empId: "A", route: "description", months: 60, relevance: 0.8 }),
		]);
		assert.equal(ranked[0]?.basis[0]?.months, 90);
		// 依据取最对得上的那条
		assert.equal(ranked[0]?.basis[0]?.route, "role");
	});

	/**
	 * 证据行那一格显示的是累计值，「前」这个前缀因此不能由某一段的 kind 决定。
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

	test("「入职前」和累计看的是同一批段：弱证据段也算", () => {
		const { ranked } = run([
			fact({ empId: "A", route: "title", kind: "external", months: 24 }),
			fact({
				empId: "A",
				route: "description",
				kind: "internal",
				months: 240,
			}),
		]);
		assert.equal(ranked[0]?.basis[0]?.external, false);
		assert.equal(ranked[0]?.basis[0]?.months, 264);
	});
});

describe("相关度", () => {
	test("同一类命中里，相关度低的排在后面", () => {
		const exact = depthOf([fact({ empId: "A", relevance: 1 })]);
		const near = depthOf([fact({ empId: "B", relevance: 0.7 })]);
		assert.ok(near < exact);
		assert.ok(near > 0, "过了阈值就不是不算");
	});

	test("相关度高的在前，不看来源", () => {
		assert.deepEqual(
			orderOf([
				fact({ empId: "A", route: "role", relevance: RELEVANCE_MIN }),
				fact({ empId: "B", route: "description", relevance: 1 }),
			]),
			["B", "A"],
		);
	});

	test("低相似的段续时长，但相关度仍取最对得上的那条", () => {
		const mixed = run([
			fact({ empId: "A", months: 12 }),
			fact({ empId: "A", relevance: 0.7, months: 240 }),
		]).ranked[0];
		const clean = depthOf([fact({ empId: "B", months: 12 })]);
		assert.ok((mixed?.depth ?? 0) > clean);
		assert.equal(mixed?.basis[0]?.relevance, 1);
	});

	test("相关度是深度的一部分：又长又新的相近命中可以反超又短又旧的原词命中", () => {
		const longNear = depthOf([
			fact({ empId: "A", relevance: 0.7, months: 240 }),
		]);
		const shortExact = depthOf([
			fact({ empId: "B", relevance: 1, months: 1, endDate: yearsAgo(30) }),
		]);
		assert.ok(longNear > shortExact);
	});

	test("依据里带着最对得上那条证据的相关度", () => {
		const { ranked } = run([
			fact({ empId: "A", relevance: 0.65 }),
			fact({ empId: "A", relevance: 0.9 }),
		]);
		assert.equal(ranked[0]?.basis[0]?.relevance, 0.9);
	});
});

describe("必须与加分", () => {
	const two = claims("must", "must");

	test("缺一条必须的主张就整个不算数", () => {
		const { ranked } = run(
			[fact({ empId: "A", claim: 0 }), fact({ empId: "B", claim: 1 })],
			two,
		);
		assert.deepEqual(
			ranked.map((r) => r.empId),
			[],
			"两个人各命中一个词，AND 语义下一个都不该留",
		);
	});

	test("必须的主张之间深度相乘；来源不同不改变名次", () => {
		const facts = [
			fact({ empId: "A", claim: 0 }),
			fact({ empId: "A", claim: 1, route: "role" }),
			fact({ empId: "B", claim: 0 }),
			fact({ empId: "B", claim: 1, route: "description" }),
			fact({ empId: "C", claim: 0 }),
			fact({ empId: "C", claim: 1, relevance: 0.6 }),
		];
		assert.deepEqual(orderOf(facts, two), ["A", "B", "C"]);
		const { ranked } = run(facts, two);
		const a = ranked.find((r) => r.empId === "A");
		const c = ranked.find((r) => r.empId === "C");
		assert.ok(
			Math.abs((c?.depth ?? 0) - (a?.depth ?? 0) * 0.6) < 1e-12,
			"一条浅，整个人被压下去",
		);
	});

	test("加分的主张不命中也留下，命中就往上抬", () => {
		const t = claims("must", "boost");
		const { ranked } = run(
			[
				fact({ empId: "A", claim: 0 }),
				fact({ empId: "A", claim: 1 }),
				fact({ empId: "B", claim: 0 }),
			],
			t,
		);
		assert.deepEqual(
			ranked.map((r) => r.empId),
			["A", "B"],
			"命中加分主张的人在前，没命中的仍然在结果里",
		);
	});

	test("只有简历里写的证据的人照样算命中", () => {
		const claimed = [fact({ empId: "B", claim: 0, route: "description" })];
		assert.equal(run(claimed, claims("must")).total, 1);
	});
});

describe("分面与名次是同一个口径", () => {
	const facts = [
		fact({ empId: "A", seqL1: "技术", seqL2: "算法", level: "P6" }),
		fact({ empId: "B", seqL1: "技术", seqL2: "算法", level: "P7" }),
		fact({ empId: "C", seqL1: "运营", seqL2: "渠道", level: "P7" }),
	];

	test("分面数的是这次检索里的人，加起来对得上总数", () => {
		const { facets, total } = run(facts);
		assert.equal(total, 3);
		assert.equal(facets.seq.find((s) => s.value.l2 === "算法")?.n, 2);
		assert.deepEqual(facets.level, [
			{ value: "P6", n: 1 },
			{ value: "P7", n: 2 },
		]);
	});

	test("算某一维时去掉这一维自己的筛选，否则选中之后就切不动了", () => {
		const { facets, total } = run(facts, claims("must"), {
			seq: [{ l1: "技术", l2: "算法" }],
		});
		assert.equal(total, 2, "结果本身是被筛过的");
		assert.equal(
			facets.seq.find((s) => s.value.l2 === "渠道")?.n,
			1,
			"别的序列还得看得见、点得动",
		);
	});

	test("一维之内多选是「或」：两个职级都要，人就是两边的并集", () => {
		const both = run(facts, claims("must"), { level: ["P6", "P7"] });
		const p6 = run(facts, claims("must"), { level: ["P6"] });
		const p7 = run(facts, claims("must"), { level: ["P7"] });
		assert.equal(both.total, p6.total + p7.total);
	});

	test("维度之间是「与」：两维各选一项，人得同时满足", () => {
		const { total } = run(facts, claims("must"), {
			level: ["P7"],
			seq: [{ l1: "技术", l2: "渠道" }],
		});
		assert.equal(total, 0, "没有人既是 P7 又在这条序列上");
	});

	test("跟人走的维度同样减少别的维度的计数", () => {
		const { facets, total } = run(facts, claims("must"), { level: ["P7"] });
		assert.equal(total, 2);
		assert.equal(facets.seq.find((s) => s.value.l2 === "算法")?.n, 1);
		assert.equal(facets.level.find((l) => l.value === "P6")?.n, 1);
	});

	test("空的人员属性不是一个可点的选项", () => {
		const { facets } = run([fact({ empId: "A" })]);
		assert.deepEqual(facets.level, []);
		assert.deepEqual(facets.recruitment, []);
	});

	test("和这次查询无关的值不进列表", () => {
		// 全站几百个二级序列，列出来只是几千行噪音
		const { facets } = run(facts);
		assert.ok(facets.seq.every((s) => s.n > 0));
	});

	test("被别的维度挤到 0 的选项留在原地，不消失", () => {
		// 列表在用户点选时变样，比列表长一点难用得多：消失的那一行是用户自己
		// 刚做的事的后果，藏起来就没法回头
		const { facets } = run(facts, claims("must"), { level: ["P6"] });
		assert.equal(facets.seq.find((s) => s.value.l2 === "渠道")?.n, 0);
	});

	test("人数并列时按值稳定排序，不随事实输入顺序变化", () => {
		const tied = [
			fact({
				empId: "A",
				seqL1: "运营",
				seqL2: "渠道",
				companyTag: "大厂",
				kind: "external",
			}),
			fact({
				empId: "B",
				seqL1: "技术",
				seqL2: "算法",
				companyTag: "外企",
				kind: "internal",
			}),
		];
		const project = (input: Fact[]) => {
			const facets = run(input).facets;
			return {
				seq: facets.seq.map((item) => `${item.value.l1}/${item.value.l2}`),
				companyTag: facets.companyTag.map((item) => item.value),
				kind: facets.kind.map((item) => item.value),
			};
		};
		assert.deepEqual(project(tied), project([...tied].reverse()));
	});
});

describe("只有人的条件的人群排序", () => {
	const facts = [
		fact({ empId: "B", seqL2: "算法", kind: "external", level: "P7" }),
		fact({ empId: "A", seqL2: "算法", kind: "internal", level: "P6" }),
		fact({ empId: "A", seqL2: "渠道", kind: "external", level: "P6" }),
	];

	test("没有语义证据时按工号稳定排序，不制造分数或证据强度", () => {
		const result = rankPopulation(facts, {});
		assert.deepEqual(result.empIds, ["A", "B"]);
		assert.equal(result.total, 2);
	});

	test("筛选要求同一经历段满足，分面仍去掉自己的维度", () => {
		const result = rankPopulation(facts, {
			seq: [{ l1: "技术", l2: "算法" }],
			kind: "external",
		});
		assert.deepEqual(result.empIds, ["B"]);
		assert.equal(
			result.facets.kind.find((item) => item.value === "internal")?.n,
			1,
		);
		assert.equal(
			result.facets.seq.find((item) => item.value.l2 === "渠道")?.n,
			1,
		);
	});
});

describe("同分的顺序是确定的", () => {
	/*
	 * 翻页靠把 limit 调大重查，所以前一页必须逐位不变。分数相同时若不定序，
	 * 第二页会漏人或让人重复出现，而界面上看不出来。
	 */
	test("同深按工号，两次求值结果一致", () => {
		const facts = ["C", "A", "B"].map((empId) => fact({ empId }));
		const once = run(facts).ranked.map((r) => r.empId);
		const twice = run([...facts].reverse()).ranked.map((r) => r.empId);
		assert.deepEqual(once, ["A", "B", "C"]);
		assert.deepEqual(twice, once);
	});
});
