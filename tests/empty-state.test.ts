/**
 * 空态说什么、给哪条下一步——**文案与出口**这一半。成因怎么判定是另一半，
 * 归 `tests/empty.test.ts`（那一半在检索层，只有那里有事实）。
 *
 * 空态是这个界面里唯一「没有数据可看」的时刻，它说什么就是产品在这一刻的
 * 全部价值。出口分两类，这一层测：改筛选走 `onChange`（同一条查询，换个
 * 看法），改条件走 `onReviseQuery`（换一个问题，会记一条新的查询记录）。
 * 它们在界面上都是一个按钮，走错了不会报错，只会让「启用全部」变成一次
 * 不留痕迹的改动。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { emptyState } from "#/routes/s/$turnId/-lib/empty-state";
import {
	CLEARED_FILTERS,
	type View,
} from "#/routes/s/$turnId/-lib/view-params";
import { compileConditions } from "#/search/compile";
import type { EmptyReason } from "#/search/empty";
import { type QueryCondition, rolesOf } from "#/search/query";
import { parseQuery } from "#/search/query-syntax";

/** 一行查询语法写成的条件，和关键词链的记录读取时编译的是同一份。 */
const compiled = (query: string) =>
	compileConditions(parseQuery(query)).conditions;

/** 跑一次空态，把按钮按下去，回收它想改的东西 */
function run(
	reason: EmptyReason,
	query = "",
	mode: "conversation" | "keyword" = "conversation",
) {
	let changed: Partial<View> | undefined;
	let revised: QueryCondition[] | undefined;
	let focused = false;
	const copy = emptyState(reason, {
		mode,
		conditions: compiled(query),
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
	test("只列出实际贡献事实行最多的条件，出口是改条件不是清筛选", () => {
		const s = run(
			{
				kind: "overflowEvidence",
				claims: rolesOf(compileConditions(parseQuery("经理"))).claims,
			},
			"算法,经理",
		);
		assert.equal(s.title, "条件范围过大");
		assert.match(s.hint, /「经理」/);
		assert.doesNotMatch(s.hint, /算法/, "贡献较少的词不背锅");
		assert.equal(s.focused, true);
		assert.equal(s.changed, undefined, "筛选不是病因");
	});

	test("人太多时提示继续缩小范围，不报成没有结果", () => {
		const s = run({ kind: "overflowPopulation" });
		assert.equal(s.title, "范围过大");
		assert.equal(s.focused, true);
	});
});

describe("条件全被停用", () => {
	test("说的是停用，出口是一键开回来，而且是改查询不是改视图", () => {
		const s = run({ kind: "allDisabled" }, "~渠道运营,~+带团队");
		assert.match(s.title, /没有启用/);
		assert.deepEqual(
			s.revised,
			compiled("渠道运营,+带团队"),
			"启用要保住原来的强度",
		);
		assert.equal(s.changed, undefined, "改条件不是改视图");
	});

	test("启用不是重写：取值一个都不能少", () => {
		const s = run({ kind: "allDisabled" }, "~大模型/多模态,~+带团队/带项目");
		assert.deepEqual(s.revised, compiled("大模型/多模态,+带团队/带项目"));
	});
});

describe("候选人较多，名单还不完整", () => {
	test("说的是候选人多、找到了哪一档职级，出口是去补充需求，不改条件也不改筛选", () => {
		const s = run({ kind: "incomplete", above: "P7" }, "算法");
		assert.equal(s.title, "候选人较多，暂时没有找到符合的人");
		assert.equal(
			s.hint,
			"已经从高职级起完整覆盖到 P7。补充需求、缩小范围后可以覆盖到更低的职级。",
		);
		assert.equal(s.action.label, "补充需求");
		assert.deepEqual(
			[s.changed, s.revised, s.focused],
			[undefined, undefined, true],
		);
	});

	test("最高一档也没找完时不说职级，只说下一步", () => {
		const s = run({ kind: "incomplete", above: null }, "算法");
		assert.equal(s.hint, "补充需求、缩小范围后可以覆盖更多人。");
	});
});

describe("其余分支各有各的文案", () => {
	test("缺少可搜的条件时让人补一个能力，不让人去动筛选", () => {
		const s = run({ kind: "noConditions" });
		assert.equal(s.focused, true);
		assert.equal(s.changed, undefined);
		assert.equal(s.title, "没有可用的搜索条件");
	});

	test("只有人的条件且无人匹配时报无结果，不报解析失败", () => {
		assert.equal(run({ kind: "gatesUnmet" }).title, "没有符合条件的人");
	});

	test("筛选太窄：一键清掉全部筛选", () => {
		// 按下去必须真的改视图，而且清的是**全部**维度：漏掉一维，人点完
		// 名单仍然是空的，而屏幕上那条下一步刚承诺过它能走通。
		assert.deepEqual(run({ kind: "filtered" }).changed, CLEARED_FILTERS);
	});

	test("AND 没满足：指向把某条必须的主张改成加分", () => {
		const s = run({ kind: "unmet" });
		assert.match(s.hint, /加分/);
		assert.equal(s.focused, true);
	});

	test("全是加分条件却没人：下一步是换词，不能再让人「改成加分」", () => {
		const s = run({ kind: "noneMatched" });
		assert.doesNotMatch(s.hint, /改为「加分」/);
		assert.match(s.hint, /加分/);
		assert.equal(s.focused, true);
	});
});

describe("关键词搜索的下一步只说框里能做的事", () => {
	test("没有加分，也没有停用：只说换词、去掉词", () => {
		const unmet = run({ kind: "unmet" }, "算法,渠道运营", "keyword");
		assert.doesNotMatch(unmet.hint, /加分/);
		assert.match(unmet.hint, /移除一个关键词/);
		assert.equal(unmet.focused, true);

		const overflow = run(
			{
				kind: "overflowEvidence",
				claims: rolesOf(compileConditions(parseQuery("经理"))).claims,
			},
			"经理",
			"keyword",
		);
		assert.doesNotMatch(overflow.hint, /停用/);
	});
});
