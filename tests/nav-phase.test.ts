/**
 * 一次导航在干什么：塌成骨架屏、只在按钮上转圈，还是什么都不做。
 *
 * 这三种情况由 loading、两头的 turn 和两头的 view 组合决定，而组合错了不会有
 * 任何东西报错——只会在扫名单时每按一下 ↑↓ 就把列表清空一次，或者翻页时把人
 * 扔回页首。所以这层组合要有自己的断言，不能只测下面那两个谓词。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { navPhase, type Spot } from "#/routes/s/$turnId/-lib/nav-phase";

const spot = (turn: string, view: Spot["view"] = {}): Spot => ({ turn, view });
const QUERY = { seq: [{ l1: "技术", l2: "后端" }] };

describe("导航相位", () => {
	test("没在飞就什么都不是", () => {
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
		// URL 每解析一次就是一个新数组。按引用比的话，一模一样的视图也会判成
		// 「筛选变了」，于是名单每换一个人就塌成骨架屏一次。
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

	test("改筛选：旧结果已经不成立，塌成骨架屏", () => {
		assert.deepEqual(
			navPhase(true, spot("a", { ...QUERY, strong: true }), spot("a", QUERY)),
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
