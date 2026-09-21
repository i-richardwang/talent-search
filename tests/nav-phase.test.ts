import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { navPhase, type Spot } from "#/routes/s/$turnId/-lib/nav-phase";

const spot = (turn: string, view: Spot["view"] = {}): Spot => ({ turn, view });
const QUERY = { seq: [{ l1: "技术", l2: "后端" }] };

describe("导航相位", () => {
	test("没有导航在进行时两项都为 false", () => {
		assert.deepEqual(
			navPhase(false, spot("a", { ...QUERY, n: 100 }), spot("a")),
			{
				growing: false,
				navigating: false,
			},
		);
	});

	test("换人不动名单——扫一遍三十个人不该把列表清空三十次", () => {
		// 同一条查询记录、同一份视图，变的只是详情路由那一段
		assert.deepEqual(navPhase(true, spot("a", QUERY), spot("a", QUERY)), {
			growing: false,
			navigating: false,
		});
	});

	test("多选维度按值比，不按引用——每次导航都是一份新解析出来的 View", () => {
		assert.deepEqual(
			navPhase(
				true,
				spot("a", { seq: [{ l1: "技术", l2: "后端" }] }),
				spot("a", { seq: [{ l1: "技术", l2: "后端" }] }),
			),
			{ growing: false, navigating: false },
		);
	});

	test("同一维选中的项变了就是改筛选", () => {
		assert.deepEqual(
			navPhase(
				true,
				spot("a", {
					seq: [
						{ l1: "技术", l2: "后端" },
						{ l1: "技术", l2: "前端" },
					],
				}),
				spot("a", { seq: [{ l1: "技术", l2: "后端" }] }),
			),
			{ growing: false, navigating: true },
		);
	});

	test("再翻一页：已经看到的人留在原地，只有按钮转圈", () => {
		assert.deepEqual(
			navPhase(true, spot("a", { ...QUERY, n: 100 }), spot("a", QUERY)),
			{ growing: true, navigating: false },
		);
	});

	test("改筛选时旧结果不再成立，显示等待态", () => {
		assert.deepEqual(
			navPhase(
				true,
				spot("a", { ...QUERY, kind: "internal" }),
				spot("a", QUERY),
			),
			{ growing: false, navigating: true },
		);
	});

	test("换一条查询记录：哪怕视图一模一样也得重画", () => {
		assert.deepEqual(navPhase(true, spot("b", QUERY), spot("a", QUERY)), {
			growing: false,
			navigating: true,
		});
	});

	test("首次进入（没有上一个位置）算重画，不算翻页", () => {
		assert.deepEqual(
			navPhase(true, spot("a", { ...QUERY, n: 100 }), undefined),
			{
				growing: false,
				navigating: true,
			},
		);
	});
});
