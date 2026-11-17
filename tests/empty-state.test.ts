/**
 * 空态说什么、给哪条下一步——**文案与出口**这一半。成因怎么判定是另一半，
 * 归 `tests/empty.test.ts`（那一半在检索层，只有那里有事实）。
 *
 * 空态是这个界面里唯一「没有数据可看」的时刻，它说什么就是产品在这一刻的
 * 全部价值。下一步分两种：按下去名单就变的（改筛选走 `onChange`，改条件走
 * `onReviseQuery`，要 AI 改写条件的走 `onSay`），和请 HR 自己再说一句的（`say`，
 * 只放光标、换示范说法）。按钮上和提示里都不出现条件强度这类 HR 不懂的说法。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	type EmptyNext,
	emptyState,
} from "#/routes/s/$turnId/-lib/empty-state";
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

/** HR 不懂的机制词：空态的任何一句都不该有 */
const MECHANISM = /加分|必须|强度|停用这一项|范围过大/;

/** 跑一次空态，按下按钮（有的话），回收它想改的东西 */
function run(
	reason: EmptyReason | ((conditions: QueryCondition[]) => EmptyReason),
	query = "",
	{
		mode = "conversation",
		ai = true,
	}: { mode?: "conversation" | "keyword"; ai?: boolean } = {},
) {
	const conditions = compiled(query);
	let changed: Partial<View> | undefined;
	let revised: QueryCondition[] | undefined;
	let said: string | undefined;
	let continued = false;
	const copy = emptyState(
		typeof reason === "function" ? reason(conditions) : reason,
		{
			mode,
			conditions,
			onChange: (next) => {
				changed = next;
			},
			onReviseQuery: (next) => {
				revised = next;
			},
			...(ai && {
				onSay: (text: string) => {
					said = text;
				},
				onContinue: () => {
					continued = true;
				},
			}),
			canSay: mode === "keyword" || ai,
		},
	);
	if (copy.next?.kind === "act") copy.next.onClick();
	assert.doesNotMatch(
		`${copy.title}${copy.hint}${label(copy.next)}`,
		MECHANISM,
	);
	return { ...copy, conditions, changed, revised, said, continued };
}

const label = (next: EmptyNext | null) =>
	next?.kind === "act" ? next.label : "";

/** 条件里哪几条的经历最宽：成因带的是同一份条件里的那几条 */
const widest =
	(...labels: string[]) =>
	(conditions: QueryCondition[]): EmptyReason => ({
		kind: "overflowEvidence",
		conditions: rolesOf({ conditions }).claims.filter((c) =>
			labels.includes(c.label),
		),
	});

/** 太宽的是排除条件：成因带的是那几条排除 */
const widestExcluded =
	(...labels: string[]) =>
	(conditions: QueryCondition[]): EmptyReason => ({
		kind: "overflowEvidence",
		conditions: rolesOf({ conditions }).excludes.filter((c) =>
			labels.includes(c.label),
		),
	});

/** 每一项单独都有人，只是凑不到一起 */
const together: EmptyReason = { kind: "unmet", nobody: [] };

/** 单独就没有人的是这几项（按标签点名） */
const nobody =
	(...labels: string[]) =>
	(conditions: QueryCondition[]): EmptyReason => ({
		kind: "unmet",
		nobody: conditions
			.filter((c) => labels.some((l) => c.label.includes(l)))
			.map((c) => c.id),
	});

describe("有一项在人才库里就没有人", () => {
	test("标题说人才库里没有；还有别的要求时一键去掉它再找，不用 AI", () => {
		const s = run(nobody("兽医"), "算法,兽医,+产品");
		assert.equal(s.title, "人才库里没有符合「兽医」的人");
		assert.equal(label(s.next), "去掉「兽医」再找");
		const off = s.revised?.filter((c) => c.off).map((c) => c.label);
		assert.deepEqual(off, ["兽医"], "只去掉没有人的那一项");
		assert.equal(s.said, undefined);
	});

	test("职级、学校这类条件没有人也一样", () => {
		const s = run(nobody("北京大学"), "department:增长中心,school:北京大学");
		assert.match(s.title, /^人才库里没有符合「.*北京大学」的人$/);
		assert.match(label(s.next), /^去掉「.*」再找$/);
	});

	test("几项都没有人时按钮说「这几项」", () => {
		const s = run(nobody("兽医", "潜水"), "算法,兽医,潜水");
		assert.equal(s.title, "「兽医」「潜水」在人才库里都没有符合的人");
		assert.equal(label(s.next), "去掉这几项再找");
	});

	test("只有这一项要求：去掉就什么都不剩，请 HR 换个说法", () => {
		const s = run(nobody("兽医"), "兽医,+产品");
		assert.deepEqual(s.next, {
			kind: "say",
			example: "换个说法，或把「兽医」说得宽一点",
		});
		assert.equal(s.revised, undefined);
	});
});

describe("每一项都有人，只是没有人同时符合", () => {
	test("标题点名是哪几项；按钮替 HR 对 AI 说「符合其中一项就行」", () => {
		const s = run(together, "算法,后端,+产品");
		assert.equal(s.title, "没有人同时符合：算法、后端");
		assert.equal(label(s.next), "符合其中一项就行");
		assert.match(s.said ?? "", /算法、后端符合其中一项就行/);
		assert.equal(s.revised, undefined, "「或者」要 AI 改写成一条，不是改强度");
	});

	test("只有职级、部门这类条件凑不到一起，也是同一句话", () => {
		const s = run(together, "department:增长中心,school:北京大学");
		assert.match(s.title, /^没有人同时符合：/);
		assert.equal(label(s.next), "符合其中一项就行");
	});

	test("没配 AI 服务时没有谁能改写，不给按钮", () => {
		const s = run(together, "算法,后端", { ai: false });
		assert.equal(s.next, null);
	});

	test("只有一项要求，人都被排除了：说是排除拦下的", () => {
		const s = run(together, "算法,-实习");
		assert.equal(s.title, "符合「算法」的人都被排除了");
		assert.equal(s.next?.kind, "say");
	});

	test("只剩加分时一项决定去留的都没有：是人才库里还没有人", () => {
		const s = run(together, "+算法");
		assert.equal(s.title, "人才库里还没有人");
		assert.equal(s.next, null);
	});
});

describe("找到的人太多", () => {
	test("太宽的那一项去掉之后还有别的条件：一键去掉再找", () => {
		const s = run(widest("经理"), "算法,经理");
		assert.equal(s.title, "「经理」太常见，找到的人太多");
		assert.equal(label(s.next), "去掉「经理」再找");
		const off = s.revised?.filter((c) => c.off).map((c) => c.label);
		assert.deepEqual(off, ["经理"], "只去掉太宽的那一项");
		assert.equal(s.changed, undefined, "筛选不是病因");
	});

	test("几项都太宽时按钮说「这几项」", () => {
		const s = run(widest("经理", "沟通"), "算法,经理,沟通");
		assert.equal(label(s.next), "去掉这几项再找");
	});

	test("太宽的就是全部条件：去掉就什么都不剩，请 HR 说得具体些", () => {
		const s = run(widest("经理"), "经理");
		assert.equal(s.next?.kind, "say");
		assert.equal(s.revised, undefined);
	});

	test("太宽的是排除条件：说要排除的那种经历太常见，一键去掉它再找", () => {
		const s = run(widestExcluded("外包"), "算法,-外包");
		assert.equal(s.title, "要排除的「外包」太常见，名单列不出来");
		assert.match(s.hint, /要排除的经历说得更具体/);
		assert.equal(label(s.next), "去掉「外包」再找");
		const off = s.revised?.filter((c) => c.off).map((c) => c.label);
		assert.deepEqual(off, ["外包"]);
	});

	test("只有职级这类条件、人太多：请 HR 补充一句", () => {
		const s = run({ kind: "overflowPopulation" });
		assert.equal(s.title, "找到的人太多，列不出来");
		assert.equal(s.next?.kind, "say");
	});
});

describe("条件全被停用", () => {
	test("一键开回来，而且是改查询不是改视图", () => {
		const s = run({ kind: "allDisabled" }, "~渠道运营,~+带团队");
		assert.equal(s.title, "搜索条件都停用了");
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

describe("名单还没列全", () => {
	test("说找到了哪一档职级、更低的还在后面，出口是条件不变接着找", () => {
		const s = run({ kind: "incomplete", above: "P7" }, "算法");
		assert.equal(s.title, "P7 及以上没有符合的人");
		assert.equal(
			s.hint,
			"更低职级的还没找完。补充职级、部门等条件可以找得更准。",
		);
		assert.equal(label(s.next), "继续找");
		assert.deepEqual(
			[s.changed, s.revised, s.continued],
			[undefined, undefined, true],
		);
	});

	test("最高一档也没找完时不说职级", () => {
		const s = run({ kind: "incomplete", above: null }, "算法");
		assert.equal(s.title, "暂时没有找到符合的人");
	});
});

describe("其余情形", () => {
	test("AI 搜不了这段需求：请 HR 换个说法，给示范", () => {
		const s = run({ kind: "noConditions" });
		assert.equal(s.title, "这段需求还搜不了");
		assert.equal(s.next?.kind, "say");
		assert.ok(s.next?.kind === "say" && s.next.example);
	});

	test("筛选太窄：一键清掉全部筛选", () => {
		// 按下去必须真的改视图，而且清的是**全部**维度：漏掉一维，人点完
		// 名单仍然是空的，而屏幕上那条下一步刚承诺过它能走通。
		assert.deepEqual(run({ kind: "filtered" }).changed, CLEARED_FILTERS);
	});
});

describe("关键词搜索的下一步只说框里能做的事", () => {
	const keyword = { mode: "keyword" } as const;

	test("没有 AI 可说话：几个词没人都写到，请 HR 去掉一个词", () => {
		const s = run(together, "算法,渠道运营", keyword);
		assert.match(s.hint, /去掉一个词/);
		assert.deepEqual(s.next, { kind: "say", example: undefined });
		assert.equal(s.said, undefined);
	});

	test("有一个词没有人写过：说出是哪个词，请 HR 去掉或换一个，不去停用", () => {
		const s = run(nobody("兽医"), "算法,兽医", keyword);
		assert.equal(s.title, "人才库里没有符合「兽医」的人");
		assert.deepEqual(s.next, { kind: "say", example: undefined });
		assert.equal(s.revised, undefined);
	});

	test("太宽的词：请 HR 换一个，不去停用", () => {
		const s = run(widest("经理"), "算法,经理", keyword);
		assert.equal(s.next?.kind, "say");
		assert.equal(s.revised, undefined);
	});

	test("还没填词：说在上方填", () => {
		assert.equal(
			run({ kind: "noConditions" }, "", keyword).title,
			"还没有填关键词",
		);
	});
});
