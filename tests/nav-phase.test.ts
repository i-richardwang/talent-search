import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	listWait,
	navPhase,
	type Spot,
} from "#/routes/s/$turnId/-lib/nav-phase";

const spot = (turn: string, view: Spot["view"] = {}): Spot => ({ turn, view });
const QUERY = { seq: [{ l1: "技术", l2: "后端" }] };
const IDLE = { growing: false, refreshing: false, replacing: false };

describe("导航相位", () => {
	test("没有导航在进行时三项都为 false", () => {
		assert.deepEqual(
			navPhase(false, spot("a", { ...QUERY, n: 100 }), spot("a")),
			IDLE,
		);
	});

	test("换人不动名单——扫一遍三十个人不该把列表清空三十次", () => {
		// 同一条查询记录、同一份视图，变的只是详情路由那一段
		assert.deepEqual(navPhase(true, spot("a", QUERY), spot("a", QUERY)), IDLE);
	});

	test("多选维度按值比，不按引用——每次导航都是一份新解析出来的 View", () => {
		assert.deepEqual(
			navPhase(
				true,
				spot("a", { seq: [{ l1: "技术", l2: "后端" }] }),
				spot("a", { seq: [{ l1: "技术", l2: "后端" }] }),
			),
			IDLE,
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
			{ ...IDLE, refreshing: true },
		);
	});

	test("再翻一页：已经看到的人留在原地，只有按钮转圈", () => {
		assert.deepEqual(
			navPhase(true, spot("a", { ...QUERY, n: 100 }), spot("a", QUERY)),
			{ ...IDLE, growing: true },
		);
	});

	test("改筛选时旧名单留在原地调暗，不换成占位", () => {
		assert.deepEqual(
			navPhase(
				true,
				spot("a", { ...QUERY, kind: "internal" }),
				spot("a", QUERY),
			),
			{ ...IDLE, refreshing: true },
		);
	});

	test("换一条查询记录：哪怕视图一模一样，旧名单也不再留着", () => {
		assert.deepEqual(navPhase(true, spot("b", QUERY), spot("a", QUERY)), {
			...IDLE,
			replacing: true,
		});
	});

	test("首次进入（没有上一个位置）算换记录，不算翻页", () => {
		assert.deepEqual(
			navPhase(true, spot("a", { ...QUERY, n: 100 }), undefined),
			{ ...IDLE, replacing: true },
		);
	});
});

describe("名单等待的样子", () => {
	test("正在理解时画占位行，哪怕导航只是改筛选", () => {
		assert.deepEqual(listWait(true, { ...IDLE, refreshing: true }), {
			list: "skeleton",
			phase: "interpreting",
		});
	});

	test("换记录画占位行，改筛选把旧名单调暗，翻页不算等待", () => {
		assert.deepEqual(listWait(false, { ...IDLE, replacing: true }), {
			list: "skeleton",
			phase: "searching",
		});
		assert.deepEqual(listWait(false, { ...IDLE, refreshing: true }), {
			list: "dim",
			phase: "searching",
		});
		assert.equal(listWait(false, { ...IDLE, growing: true }), null);
	});
});
