/**
 * 打分与排序。**不连数据库**，全部语义以纯函数方式验证。
 *
 * 这里测的是「一份事实应该排出什么名次」；「事实本身对不对」是 search.test.ts
 * 的事，两边不重叠。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	type Fact,
	gapMonths,
	pageHits,
	rank,
	rankPopulation,
} from "#/search/rank";
import type { Claim, SearchFilters } from "#/search/result";
import {
	BOOST_WEIGHT,
	RECENCY_FLOOR,
	RELEVANCE_MIN,
	ROUTE_WEIGHTS,
	TENURE_FLOOR,
} from "#/search/weights";
import { claim } from "./conditions";

/** 固定的「今天」：近因因子让分数依赖当前时间，测试不能跟着日历漂 */
const NOW = new Date(2026, 0, 1);

let nextId = 1;
function fact(p: Partial<Fact> & { empId: string }): Fact {
	return {
		id: nextId++,
		claim: 0,
		value: "词0",
		route: "seq",
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
		recruitment: "",
		education: "",
		...p,
	};
}

const claims = (...modes: Claim["mode"][]): Claim[] =>
	modes.map((mode, i) => claim(`词${i}`, { mode }) as Claim);

const run = (facts: Fact[], t = claims("must"), f: SearchFilters = {}) =>
	rank(facts, t, f, NOW);

const scoreOf = (facts: Fact[], t?: Claim[], f?: SearchFilters) => {
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

	test("两个下限的乘积必须大于相邻路权重的比值，否则上面两条迟早会红", () => {
		// 对常数本身也断言：改下限的人不一定会去跑上面那两条的边界值
		const weights = Object.values(ROUTE_WEIGHTS).sort((a, b) => b - a);
		const worst = Math.min(
			...weights.slice(1).map((w, i) => w / (weights[i] as number)),
		);
		assert.ok(
			TENURE_FLOOR * RECENCY_FLOOR > worst,
			`下限乘积 ${TENURE_FLOOR * RECENCY_FLOOR} 必须大于 ${worst}`,
		);
	});
});

/** 一条主张的几个经历词同权：靠哪个词命中只进证据行，不进分。 */
describe("取值", () => {
	test("同一段原文，靠哪个取值命中分数都一样", () => {
		const first = scoreOf([fact({ empId: "A", value: "词0" })]);
		const other = scoreOf([fact({ empId: "A", value: "别的取值" })]);
		assert.equal(first, other);
	});

	test("同一段几个取值都命中时取最强的那条，不叠加", () => {
		const both = scoreOf([
			fact({ empId: "A", id: 7, value: "词0" }),
			fact({ empId: "A", id: 7, value: "别的取值", relevance: 0.8 }),
		]);
		const one = scoreOf([fact({ empId: "A", id: 7, value: "词0" })]);
		// 同段两行本该在取数 SQL 里就去重掉（search.ts 的 textualFacts），
		// 这里只保证万一漏到内存里，强度按最强的那条算，月份也不因此翻倍。
		assert.equal(both, one);
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

	test("有下限：一段很短的经历不归零", () => {
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

	test("无效日期不冒充仍在做", () => {
		assert.throws(() => gapMonths("not-a-date", NOW), /无效结束日期/);
	});

	test("还在做的高于早就不做的", () => {
		const now = scoreOf([fact({ empId: "A" })]);
		const old = scoreOf([fact({ empId: "B", endDate: yearsAgo(3) })]);
		assert.ok(now > old);
	});

	test("越久越低，但有下限——五年前干过也还是干过", () => {
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
		assert.equal(ranked[1]?.score, (plain[0]?.score ?? 0) * (1 + BOOST_WEIGHT));
		assert.equal(
			ranked[0]?.score,
			(plain[0]?.score ?? 0) * (1 + BOOST_WEIGHT) ** 2,
		);
	});
});

describe("没有经历词的主张", () => {
	test("落在范围里的段就是证据：强度是登记那一档，证据要求也认它", () => {
		const plain = [fact({ empId: "A", route: null, value: null })];
		const seq = [fact({ empId: "B", route: "seq" })];
		assert.equal(scoreOf(plain), scoreOf(seq));
		assert.equal(run(plain, claims("must"), { strong: true }).total, 1);
		assert.deepEqual(run(plain).ranked[0]?.basis[0], {
			route: null,
			value: null,
			relevance: 1,
			months: 24,
			endDate: null,
			external: false,
		});
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
			ranked[0]?.score,
			ranked[1]?.score,
			"十二个月够不上三年，A 不该被抬",
		);
		// 名次里没有它，证据行上就不能有它：留一条「+ 词0 · 1 年」画成命中，
		// 读者会问为什么它没把 A 抬到前面
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
				route: "seq",
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
				route: "seq",
				value: "词0",
				relevance: 1,
				months: 24,
				endDate: null,
				external: false,
			},
			null,
		]);
	});

	test("全部证据段共同累计，不分哪一路：一段简历里提过的算法经历也是算法经历", () => {
		const { ranked } = run([
			fact({ empId: "A", route: "seq", months: 12 }),
			fact({ empId: "A", route: "title", months: 18 }),
			fact({ empId: "A", route: "description", months: 60 }),
		]);
		assert.equal(ranked[0]?.basis[0]?.months, 90);
		// 强度仍只看最强那条：累计不会把自述抬成登记
		assert.equal(ranked[0]?.basis[0]?.route, "seq");
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
			fact({ empId: "A", route: "seq", kind: "external", months: 24 }),
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

describe("相关度（路权重 × 相关度）", () => {
	test("同一路上，相关度低的命中低于高的", () => {
		const exact = scoreOf([fact({ empId: "A", relevance: 1 })]);
		const near = scoreOf([fact({ empId: "B", relevance: 0.7 })]);
		assert.ok(near < exact);
		assert.ok(near > 0, "过了阈值就不是不算");
	});

	test("刚过阈值的受控命中，基础强度仍高于相似 1.0 的部门命中", () => {
		// 登记字段说他真在干这个，相关度只是翻译损耗——方向见 weights.ts
		assert.ok(RELEVANCE_MIN * ROUTE_WEIGHTS.seq > ROUTE_WEIGHTS.org);
	});

	test("低相似的段续时长，但强度仍取最强那条", () => {
		const mixed = run([
			fact({ empId: "A", months: 12 }),
			fact({ empId: "A", relevance: 0.7, months: 240 }),
		]).ranked[0];
		const clean = scoreOf([fact({ empId: "B", months: 12 })]);
		assert.ok((mixed?.score ?? 0) > clean);
		assert.equal(mixed?.basis[0]?.relevance, 1);
	});

	test("相关度不受下限保护：又长又新的相近命中可以反超又短又旧的原词命中", () => {
		const longNear = scoreOf([
			fact({ empId: "A", relevance: 0.7, months: 240 }),
		]);
		const shortExact = scoreOf([
			fact({ empId: "B", relevance: 1, months: 1, endDate: yearsAgo(30) }),
		]);
		assert.ok(longNear > shortExact);
	});

	test("依据里带着最强那条证据的相关度", () => {
		const { ranked } = run([
			fact({ empId: "A", relevance: 0.65 }),
			fact({ empId: "A", relevance: 0.9 }),
		]);
		assert.equal(ranked[0]?.basis[0]?.relevance, 0.9);
	});

	test("证据要求看的是路（受控字段），与相关度正交", () => {
		const facts = [fact({ empId: "A", relevance: 0.65 })];
		assert.equal(run(facts, claims("must"), { strong: true }).total, 1);
	});
});

describe("累计跨档位，但档位不被累计翻盘", () => {
	test("简历里提过一句给序列命中续时长，却压不过一段短的序列命中的档位", () => {
		const mixed = scoreOf([
			fact({ empId: "A", route: "seq", months: 12 }),
			fact({ empId: "A", route: "description", months: 240 }),
		]);
		const clean = scoreOf([fact({ empId: "B", route: "seq", months: 12 })]);
		assert.ok(mixed > clean, "累计答的是「沉淀了多久」，自述的段也算");
		const orgLong = scoreOf([fact({ empId: "C", route: "org", months: 252 })]);
		assert.ok(clean > orgLong, "档位仍由最强证据定，时长翻不了盘");
	});
});

describe("必须、加分与证据要求", () => {
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

	test("必须的主张之间是乘积：一条弱，整个人被压下去", () => {
		const strong = scoreOf(
			[
				fact({ empId: "A", claim: 0 }),
				fact({ empId: "A", claim: 1, route: "seq" }),
			],
			two,
		);
		const weak = scoreOf(
			[
				fact({ empId: "B", claim: 0 }),
				fact({ empId: "B", claim: 1, route: "description" }),
			],
			two,
		);
		assert.ok(strong > weak);
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

	test("证据要求只管必须的主张，且要求每条都有受控命中", () => {
		const facts = [
			fact({ empId: "A", claim: 0, route: "seq" }),
			fact({ empId: "B", claim: 0, route: "description" }),
		];
		assert.deepEqual(
			run(facts, claims("must"), { strong: true }).ranked.map((r) => r.empId),
			["A"],
		);
		assert.equal(run(facts).total, 2, "关掉之后两个人都在");
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
		assert.equal(facets.strong.off, total, "关掉证据要求就是当前全部");
	});

	test("算某一维时摘掉这一维自己的筛选，否则选中之后就切不动了", () => {
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

	test("跟人走的维度同样收窄别的维度", () => {
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
		// 列表在手底下换形状，比列表长一点难用得多：消失的那一行是用户自己
		// 刚做的事的后果，藏起来就没法回头
		const { facets } = run(facts, claims("must"), { level: ["P6"] });
		assert.equal(facets.seq.find((s) => s.value.l2 === "渠道")?.n, 0);
	});

	test("人数并列时按值稳定排序，不跟着事实输入顺序漂移", () => {
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
		const result = rankPopulation(facts, { strong: true });
		assert.deepEqual(result.empIds, ["A", "B"]);
		assert.equal(result.total, 2);
		assert.deepEqual(result.facets.strong, { on: 0, off: 0 });
	});

	test("筛选要求同一经历段满足，分面仍摘掉自己的维度", () => {
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
	test("同分按工号，两次求值结果一致", () => {
		const facts = ["C", "A", "B"].map((empId) => fact({ empId }));
		const once = run(facts).ranked.map((r) => r.empId);
		const twice = run([...facts].reverse()).ranked.map((r) => r.empId);
		assert.deepEqual(once, ["A", "B", "C"]);
		assert.deepEqual(twice, once);
	});
});
