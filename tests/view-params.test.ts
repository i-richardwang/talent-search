/**
 * URL 视图状态的收口。
 *
 * 查询本身已经不在 URL 里了（它是一条有 id 的记录，见 `server/turn.ts`），
 * 这里剩下的是「怎么看这批人」：五个筛选维度加一个翻页数。它们仍然是这个
 * 应用最不可信的入口——手改地址、旧书签、同事粘来的链接都会原样送进来。
 * 这一层的职责是让非法值一律退化成「没填」，而不是带着一个说不通的值往下走
 * ——`minMonths` 尤其，它是唯一参与数值比较的筛选。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	canLoadMore,
	hasFilters,
	morePage,
	onlyMore,
	pageLimit,
	toFilters,
	validateView,
	viewChanged,
} from "#/routes/-lib/view-params";
import { RESULT_MAX, RESULT_PAGE } from "#/search/weights";

describe("最短时长只收正整数", () => {
	test("负数不能把筛选变成恒真", () => {
		assert.equal(validateView({ minMonths: "-999" }).minMonths, undefined);
		assert.equal(validateView({ minMonths: -1 }).minMonths, undefined);
	});

	test("小数会渲染出「1 年 0.5 个月」这种档位，也不收", () => {
		assert.equal(validateView({ minMonths: "12.5" }).minMonths, undefined);
	});

	test("非数字与零一律当没填", () => {
		for (const v of ["", "abc", "0", null, undefined, {}, []]) {
			assert.equal(
				validateView({ minMonths: v }).minMonths,
				undefined,
				`${JSON.stringify(v)} 不该通过`,
			);
		}
	});

	test("正整数原样通过，包括分面档位之外的值", () => {
		assert.equal(validateView({ minMonths: "12" }).minMonths, 12);
		assert.equal(validateView({ minMonths: 18 }).minMonths, 18);
	});
});

describe("文本字段", () => {
	test("两头的空白不算内容", () => {
		assert.equal(validateView({ seq: "   " }).seq, undefined);
		assert.equal(validateView({ seq: " 技术/后端 " }).seq, "技术/后端");
	});

	test("非字符串一律当没填", () => {
		assert.equal(validateView({ companyTag: ["大厂"] }).companyTag, undefined);
	});
});

describe("枚举与开关", () => {
	test("经历类型只认两个值", () => {
		assert.equal(validateView({ kind: "internal" }).kind, "internal");
		assert.equal(validateView({ kind: "external" }).kind, "external");
		assert.equal(validateView({ kind: "both" }).kind, undefined);
	});

	test("证据要求只有打开和没填两态，不存在显式的 false", () => {
		assert.equal(validateView({ strong: true }).strong, true);
		assert.equal(validateView({ strong: "true" }).strong, true);
		assert.equal(validateView({ strong: "false" }).strong, undefined);
		assert.equal(validateView({ strong: "1" }).strong, undefined);
	});
});

describe("URL 状态翻成检索条件", () => {
	test("序列在 URL 里是一个值，到检索条件是两列", () => {
		const f = toFilters({ seq: "技术/数据科学" });
		assert.equal(f.seqL1, "技术");
		assert.equal(f.seqL2, "数据科学");
		// 其余维度没写就是没写：不能变成空串去和列比较
		for (const [k, v] of Object.entries(f))
			if (k !== "seqL1" && k !== "seqL2") assert.equal(v, undefined, k);
	});

	test("只给一级也成立：那就是只按一级收窄", () => {
		const f = toFilters({ seq: "技术" });
		assert.equal(f.seqL1, "技术");
		assert.equal(f.seqL2, undefined);
	});

	test("没有序列时两列都不设，不能变成空串去和列比较", () => {
		const f = toFilters({});
		assert.equal(f.seqL1, undefined);
		assert.equal(f.seqL2, undefined);
	});
});

describe("有没有生效的筛选", () => {
	test("任一收窄维度生效即为真", () => {
		assert.ok(hasFilters({ seq: "技术/数据科学" }));
		assert.ok(hasFilters({ companyTag: "大厂" }));
		assert.ok(hasFilters({ minMonths: 12 }));
		assert.ok(hasFilters({ kind: "internal" }));
		assert.ok(hasFilters({ level: "P7" }));
		assert.ok(hasFilters({ recruitment: "校招" }));
		assert.ok(hasFilters({ education: "硕士" }));
		assert.ok(hasFilters({ org: "支付" }));
		assert.ok(hasFilters({ school: "浙江大学" }));
	});

	test("查询词和证据要求都不算筛选——空态要靠它区分「筛太窄」和「词太窄」", () => {
		assert.ok(!hasFilters({}));
		assert.ok(!hasFilters({ strong: true }));
	});
});

/**
 * 翻页。
 *
 * 它和其余五维不同的地方在于：非法值不只是「说不通」，还会变成一次
 * 拉几万行的查询。而 `n=51` 这种数更阴——它不报错，只是让同一次查询
 * 产生一份界面上任何按钮都到不了的结果。
 */
describe("翻页只认整页", () => {
	test("默认不写进 URL：第一屏的链接不该带 n", () => {
		assert.equal(validateView({}).n, undefined);
		assert.equal(validateView({ n: RESULT_PAGE }).n, undefined);
		assert.equal(pageLimit(validateView({})), RESULT_PAGE);
	});

	test("整页的倍数才通过", () => {
		assert.equal(validateView({ n: RESULT_PAGE * 3 }).n, RESULT_PAGE * 3);
		assert.equal(
			validateView({ n: String(RESULT_PAGE * 2) }).n,
			RESULT_PAGE * 2,
		);
	});

	test("半页、负数、小数、非数字一律当没翻过页", () => {
		for (const v of ["51", -50, 12.5, "abc", "", null, {}]) {
			assert.equal(
				validateView({ n: v }).n,
				undefined,
				`${JSON.stringify(v)} 不该通过`,
			);
		}
	});

	test("手改一个超大的 n 也只封到上限", () => {
		assert.equal(validateView({ n: 99999 }).n, undefined, "非整页不通过");
		assert.equal(validateView({ n: RESULT_MAX * 4 }).n, RESULT_MAX);
	});
});

describe("还能不能再翻", () => {
	test("看完了就不给按钮", () => {
		assert.equal(canLoadMore({}, RESULT_PAGE), false);
		assert.equal(canLoadMore({}, RESULT_PAGE + 1), true);
	});

	test("到上限就不给按钮，哪怕后面还有人", () => {
		assert.equal(canLoadMore({ n: RESULT_MAX }, RESULT_MAX * 10), false);
	});

	test("再翻一页也翻不过上限", () => {
		assert.equal(morePage({}).n, RESULT_PAGE * 2);
		assert.equal(morePage({ n: RESULT_MAX }).n, RESULT_MAX);
	});
});

/**
 * 「这次导航只是再看一页」的判定。判错的代价是**看得见的**：判成换查询，
 * 表格会在翻页时塌成骨架屏，人被扔回页首；判成翻页，换了查询之后旧结果
 * 会挂在屏幕上假装还成立。
 */
describe("翻页与换查询要分得开", () => {
	const base = { seq: "技术/后端" };

	test("只有 n 变大才算翻页", () => {
		assert.equal(onlyMore({ ...base, n: 100 }, base), true);
		assert.equal(onlyMore(base, { ...base, n: 100 }), false, "往回退不是翻页");
		assert.equal(onlyMore(base, base), false, "什么都没变不是翻页");
	});

	test("查询或筛选跟着变了就不是翻页", () => {
		assert.equal(onlyMore({ ...base, seq: "技术/前端", n: 100 }, base), false);
		assert.equal(onlyMore({ ...base, seq: undefined, n: 100 }, base), false);
		assert.equal(onlyMore({ ...base, strong: true, n: 100 }, base), false);
	});

	test("没有上一个位置时（首次进入）不算翻页", () => {
		assert.equal(onlyMore({ ...base, n: 100 }, undefined), false);
	});

	test("只切换详情路由不触发结果骨架屏", () => {
		assert.equal(viewChanged(base, base), false);
		assert.equal(viewChanged({ ...base, seq: "技术/前端" }, base), true);
		assert.equal(viewChanged({ ...base, n: 100 }, base), true);
	});
});
