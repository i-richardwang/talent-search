/**
 * 筛选面板的候选与计数。
 *
 * 这组测试测的是**口径**：每一项后面的数是「选了它之后还剩多少人」，和表头
 * 那句「N 人」同一个单位，所以它必须和主检索用同一套 AND 语义。误计成经历段
 * 的话，分面会远大于结果人数，两个数字在同一屏上互相拆台。
 *
 * 种子是这个文件自己的：那条穷举不变量（每一维每一个候选都真的搜一遍）只有
 * 在语料确定的时候才说得清自己验到了什么——搭在别处攒出来的语料上，某一维
 * 哪天一个候选都没有了，它会安静地少验一维。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	DIM_KEYS,
	type DimKey,
	type DimUnit,
	dimId,
	isMulti,
} from "#/search/dimensions";
import { parsePopulation } from "#/search/params";
import { parseQuery } from "#/search/query-syntax";
import type { SearchFilters } from "#/search/result";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { search } = await import("#/search/search");

const run = async (query: string, filters: SearchFilters = {}) => {
	const outcome = await search(
		{ requirements: parseQuery(query), scope: {}, notices: [] },
		filters,
	);
	if (outcome.order !== "relevance")
		throw new Error("要求查询未进入相关度路径");
	return outcome;
};

before(async () => {
	await seed([
		// 跟人走的那三维也要有值：不然「分面口径 ≡ 主检索口径」那条穷举
		// 在它们身上一个候选都拿不到，会安静地少验三维。
		{
			empId: "F001",
			name: "分面甲",
			curLevel: "P6",
			recruitment: "校招",
			education: "本科",
			segments: [{ seqL1: "技术", seqL2: "算法", months: 36 }],
		},
		{
			empId: "F002",
			name: "分面乙",
			curLevel: "P7",
			recruitment: "社招",
			education: "硕士",
			segments: [{ seqL1: "技术", seqL2: "算法", months: 36 }],
		},
		{
			empId: "F003",
			name: "分面丙",
			curLevel: "P7",
			recruitment: "校招",
			education: "硕士",
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
					// 能力词那一维是一段多个值：两个词都得成为候选，各数一个人
					skills: ["推荐系统", "Python"],
				},
			],
		},
		// 公司档没被标过的那一段：「未知」在这一维里哪儿都不是取值
		{
			empId: "U001",
			name: "公司档没标过",
			segments: [
				{
					kind: "external",
					title: "算法",
					months: 12,
					companyTag: "未知",
					skills: ["推荐系统"],
				},
			],
		},
	]);
});

describe("候选与计数", () => {
	const seqOf = (facets: Awaited<ReturnType<typeof search>>["facets"]) =>
		new Map(facets.seq.map((s) => [`${s.value.l1}/${s.value.l2}`, s.n]));

	test("能力词一段多个值：每个词各成候选，按人数而不是按边数", async () => {
		const { facets } = await run("算法");
		const skills = new Map(facets.skill.map((s) => [s.value, s.n]));
		assert.equal(skills.get("推荐系统"), 2);
		assert.equal(skills.get("Python"), 1);
	});

	test("数的是人，而且只数这一次检索里的人", async () => {
		const { facets } = await run("算法");
		// 全库还有别的人序列里写着算法，但他们没有 seq_l1，进不了这一维；
		// 关键是这个数不可能超过命中总人数
		assert.equal(seqOf(facets).get("技术/算法"), 3);
		assert.equal(seqOf(facets).get("运营/渠道"), 1);
	});

	test("口径和主检索一致：一个人要在这一项里凑齐全部要求才算数", async () => {
		// F003 一段之内既有岗位「算法运维」又有序列「渠道」，两个词都落在「运营/渠道」里
		const { facets } = await run("算法,渠道");
		assert.equal(seqOf(facets).get("运营/渠道"), 1);
		// F001/F002 在「技术/算法」里凑不齐「渠道」，这一项一个人都不剩
		assert.equal(seqOf(facets).get("技术/算法"), undefined);
	});

	test("算某一维时要摘掉这一维自己的筛选，否则选中之后就切不动了", async () => {
		const { facets, results } = await run("算法", {
			seq: [{ l1: "技术", l2: "算法" }],
		});
		assert.equal(results.length, 3, "结果本身是被筛过的");
		// 但序列这一维的候选不受它自己影响，别的序列还看得见、点得动
		assert.equal(seqOf(facets).get("运营/渠道"), 1);
		assert.equal(seqOf(facets).get("技术/算法"), 3);
	});

	test("别的维度的筛选照常收窄计数，但不让选项消失", async () => {
		// 只看入职前时，三位只有内部事实的人不能为任何序列贡献计数；
		// 「运营/渠道」因此归零，但它留在列表里（界面上是禁用的那一行）——
		// 列表只随查询变形，不随筛选变形，见 rank.ts 的 facetRows
		const { facets } = await run("算法", { kind: "external" });
		assert.equal(seqOf(facets).get("技术/算法"), 1);
		assert.equal(seqOf(facets).get("运营/渠道"), 0);
	});

	test("和这次查询无关的值不进列表——分面比全站短靠的是这个", async () => {
		// 没有筛选时值域和计数是同一个口径，所以这里一个 0 都不该有
		const { facets } = await run("算法");
		assert.ok(
			facets.seq.every((s) => s.n > 0),
			"没筛任何东西时不该出现计数为 0 的选项",
		);
		assert.ok(
			facets.companyTag.every((t) => t.value !== "" && t.value !== "未知"),
			"空档和未知档不是可点的筛选项",
		);
	});

	test("公司档与经历类型同样跟着查询走", async () => {
		const { facets } = await run("算法");
		// 「未知」不是公司档（见下面那条），所以这一维只有 F004 那一个取值
		assert.deepEqual(facets.companyTag, [{ value: "头部互联网T1", n: 1 }]);
		// 入职前的两个人：F004 和公司档没标过的 U001
		assert.equal(facets.kind.find((k) => k.value === "external")?.n, 2);
	});

	test("没有要求就没有候选，不拿全库的数字充数", async () => {
		const { facets } = await run("帮我找一下的人");
		assert.deepEqual(facets.seq, []);
		assert.deepEqual(facets.minMonths, []);
	});
});

/**
 * **分面的口径 ≡ 主检索的口径。** 分面和排名各自对同一份事实求值，一致性没有
 * 任何类型或构建能保证。可它是筛选栏能不能被信任的全部依据——「P6 旁边那个 20」
 * 说的是「再勾上 P6 会剩下这些人」，说错了屏幕上什么都看不出来，只有点下去才
 * 发现数对不上，而那时候人已经在怀疑整份名单了。
 *
 * 所以这里不举例子，穷举：拿一次真实检索的每一维、每一个候选值，逐个真的搜
 * 一遍，比对「预告的人数」和「真搜出来的总数」。
 */
describe("分面预告的数就是点下去会得到的数", () => {
	const QUERY = "算法/运营";

	/** 把一个候选取值写成这一维的一次选择。集合维给一项，单值维给它本身。 */
	const pick = <K extends DimKey>(key: K, value: DimUnit[K]): SearchFilters =>
		({ [key]: isMulti(key) ? [value] : value }) as SearchFilters;

	test("每一维的每一个值都对得上", async () => {
		const base = await run(QUERY);
		// 逐维手写的话，加一维就会有一维没人验——而这条不变量正是加一维时
		// 最容易碰坏的东西。遍历维度表，新维度自动进这个循环。
		const checks: { label: string; n: number; filters: SearchFilters }[] = [
			...DIM_KEYS.flatMap((key) =>
				base.facets[key].map((row) => ({
					label: `${key} ${dimId(key, row.value)}`,
					n: row.n,
					filters: pick(key, row.value),
				})),
			),
			{
				label: "strong on",
				n: base.facets.strong.on,
				filters: { strong: true },
			},
			{ label: "strong off", n: base.facets.strong.off, filters: {} },
		];
		assert.ok(checks.length > 8, "夹具至少要给出几维可点的候选");
		for (const check of checks) {
			const { total } = await run(QUERY, check.filters);
			assert.equal(total, check.n, check.label);
		}
	});

	/**
	 * 同一个条件，作为查询范围（下推给 SQL）和作为筛选（在内存里求值），
	 * 必须选出同一批人。
	 *
	 * 这是「一份声明、两个求值器」的全部赌注：两个求值器读的是同一段声明，
	 * 但它们分别落在 `search.ts` 的列表达式和 `dimensions.ts` 的 `values` 上，
	 * 写歪一个不会有任何东西报错——名单会安静地少几个人。
	 */
	test("同一个条件下推给数据库还是在内存里筛，选出的是同一批人", async () => {
		const base = await run(QUERY);
		const covered = new Set<DimKey>();
		for (const key of DIM_KEYS)
			for (const row of base.facets[key]) {
				covered.add(key);
				const filtered = await run(QUERY, pick(key, row.value));
				const scoped = await search(
					{
						requirements: parseQuery(QUERY),
						scope: pick(key, row.value),
						notices: [],
					},
					{},
				);
				assert.deepEqual(
					scoped.results.map((r) => r.employee.empId),
					filtered.results.map((r) => r.employee.empId),
					`${key} ${dimId(key, row.value)}`,
				);
			}
		// 哪一维在这次查询里一个候选都没有，这条不变量就没验到它——而
		// 「列表达式写歪了」正是要靠它才看得见的东西。
		assert.deepEqual([...covered].sort(), [...DIM_KEYS].sort());
	});

	/**
	 * 「未知」说的是「这一项没被标过」，不是一个公司档。它在这一维里**哪儿都不是
	 * 取值**：不出现在候选里、清洗留不下、内存谓词也不认。三处对不上的话，
	 * 下推出去的 `in ('未知')` 会选中一批内存谓词当场否掉的行，而屏幕上是一个
	 * 选中了却空着的筛选。
	 */
	test("「未知」不是取值：候选里没有，清洗留不下，谓词也不认", async () => {
		const { facets } = await run(QUERY);
		assert.ok(
			facets.companyTag.every((row) => row.value !== "未知"),
			"没标过的段不该变出一个可点的公司档",
		);
		assert.deepEqual(parsePopulation({ companyTag: ["未知"] }), {});
		assert.deepEqual(
			parsePopulation({ companyTag: ["未知", "头部互联网T1"] }),
			{
				companyTag: ["头部互联网T1"],
			},
		);
		assert.equal((await run(QUERY, { companyTag: ["未知"] })).total, 0);
	});

	test("已经筛着的时候，别的维度报的仍是「再勾上它会剩几人」", async () => {
		const picked: SearchFilters = { kind: "internal" };
		const base = await run(QUERY, picked);
		for (const row of base.facets.level) {
			const { total } = await run(QUERY, { ...picked, level: [row.value] });
			assert.equal(total, row.n, `level ${row.value}`);
		}
		// 自己这一维摘掉自己：选中一项之后，同维其余项报的不是 0
		for (const row of base.facets.kind) {
			const { total } = await run(QUERY, { ...picked, kind: row.value });
			assert.equal(total, row.n, `kind ${row.value}`);
		}
	});
});
