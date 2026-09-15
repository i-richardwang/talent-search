/**
 * 空态说什么、给哪条出路——**文案与出口**这一半。成因怎么判定是另一半，
 * 归 `tests/empty.test.ts`（那一半住在检索层，它手里才有事实）。
 *
 * 空态是这个界面里唯一「没有数据可看」的时刻，它说什么就是产品在这一刻的
 * 全部价值。出口分两类，这一层测：改筛选走 `onChange`（同一条查询，换个
 * 看法），改条件走 `onReviseQuery`（换一个问题，会派生一条新的查询记录）。
 * 两者在界面上都是一个按钮，走错了不会报错，只会让「启用全部」变成一次
 * 不留痕迹的改动。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { emptyState } from "#/routes/s/$turnId/-lib/empty-state";
import {
	CLEARED_FILTERS,
	type View,
} from "#/routes/s/$turnId/-lib/view-params";
import type { Condition } from "#/search/condition";
import type { EmptyReason } from "#/search/empty";
import { parseQuery } from "#/search/query-syntax";
import { claimsOf } from "#/search/result";

/** 跑一次空态，把按钮按下去，回收它想改的东西 */
function run(reason: EmptyReason, query = "") {
	let changed: Partial<View> | undefined;
	let revised: Condition[] | undefined;
	let focused = false;
	const copy = emptyState(reason, {
		conditions: parseQuery(query),
		onChange: (next) => {
			changed = next;
		},
		onReviseQuery: (next) => {
			revised = next;
		},
		onEditQuery: () => {
			focused = true;
		},
	});
	copy.action.onClick();
	return { ...copy, changed, revised, focused };
}

describe("取数超限：是一种结果，不是一次失败", () => {
	test("只点名实际贡献事实行最多的条件，出口是改条件不是清筛选", () => {
		const s = run(
			{ kind: "overflowEvidence", claims: claimsOf(parseQuery("经理")) },
			"算法,经理",
		);
		assert.equal(s.title, "条件太宽");
		assert.match(s.hint, /「经理」/);
		assert.doesNotMatch(s.hint, /算法/, "贡献较少的词不背锅");
		assert.equal(s.focused, true);
		assert.equal(s.changed, undefined, "筛选不是病因");
	});

	test("人太多时提示继续收窄，不报成没有结果", () => {
		const s = run({ kind: "overflowPopulation" });
		assert.equal(s.title, "范围太大");
		assert.equal(s.focused, true);
	});
});

describe("条件全被停用", () => {
	test("说的是停用，出口是一键开回来，而且是改查询不是改视图", () => {
		const s = run({ kind: "allDisabled" }, "~渠道运营,~+带团队");
		assert.match(s.title, /没有启用/);
		assert.deepEqual(
			s.revised,
			parseQuery("渠道运营,+带团队"),
			"启用要保住原来的强度",
		);
		assert.equal(s.changed, undefined, "改条件不是改视图");
	});

	test("启用不是重写：取值一个都不能少", () => {
		const s = run({ kind: "allDisabled" }, "~大模型/多模态,~+带团队/带项目");
		assert.deepEqual(s.revised, parseQuery("大模型/多模态,+带团队/带项目"));
	});
});

describe("其余分支各有各的文案", () => {
	test("缺少可搜的条件时让人补一个能力，不让人去动筛选", () => {
		const kinds = ["excludeOnly", "noConditions"] as const;
		for (const kind of kinds) {
			const s = run({ kind });
			assert.equal(s.focused, true, kind);
			assert.equal(s.changed, undefined, kind);
		}
		assert.equal(run({ kind: "excludeOnly" }).title, "还缺一项条件");
		assert.equal(run({ kind: "noConditions" }).title, "没有读出条件");
	});

	test("只有人的条件且无人匹配时报无结果，不报解析失败", () => {
		assert.equal(run({ kind: "personEmpty" }).title, "没有这样的人");
	});

	test("证据要求滤空了：报出关掉之后能看到几个，出口就是关掉它", () => {
		const s = run({ kind: "strongEmpty", without: 12 });
		assert.match(s.hint, /12/);
		assert.deepEqual(s.changed, { strong: undefined });
	});

	test("筛选太窄：一键清筛选，但不动证据要求", () => {
		const s = run({ kind: "filtered" });
		// 按下去必须真的改视图，而且清的是**全部**收窄维度：漏掉一维，人点完
		// 名单照旧是空的，而屏幕上那条出路刚承诺过它能走通。
		assert.deepEqual(s.changed, CLEARED_FILTERS);
		assert.ok(
			!("strong" in (s.changed ?? {})),
			"证据要求不属于「清除筛选」的范围",
		);
	});

	test("AND 没满足：指向把某条必须的主张改成加分", () => {
		const s = run({ kind: "unmet" });
		assert.match(s.hint, /加分/);
		assert.equal(s.focused, true);
	});

	test("全是加分条件却没人：出路是换词，不能再让人「改成加分」", () => {
		const s = run({ kind: "noHits" });
		assert.doesNotMatch(s.hint, /改为「加分」/);
		assert.match(s.hint, /加分/);
		assert.equal(s.focused, true);
	});
});
