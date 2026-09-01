/**
 * 七种空结果的说法与出口。
 *
 * 空态是这个界面里唯一「没有数据可看」的时刻，它说什么就是产品在这一刻的
 * 全部价值。而这几种成因长得一模一样（都是零行），说错了没有任何断言会红，
 * 用户只会得到一句「没有人同时满足全部条件」然后无从下手——尤其是
 * 「你自己把条件全停用了」这一种，它和「真的没有这样的人」完全相反。
 *
 * 出口还分两类，这一层也钉住：改筛选走 `onChange`（同一条查询，换个看法），
 * 改条件走 `onReviseQuery`（换一个问题，会派生一条新的查询记录）。
 * 两者在界面上都是一个按钮，走错了不会报错，只会让「启用全部条件」
 * 变成一次不留痕迹的改动。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { emptyState } from "#/routes/-lib/empty-state";
import type { View } from "#/routes/-lib/view-params";
import { type Chip, parseChips } from "#/search/parse";
import type { TermPlan } from "#/search/result";

const must = (term: string): TermPlan => ({
	term,
	members: [{ text: term, effective: term, tier: "full" }],
	mode: "must",
});

/** 跑一次空态，把按钮按下去，回收它想改的东西 */
function run(args: {
	terms?: TermPlan[];
	q?: string;
	tooWide?: boolean;
	withoutStrong?: number;
	view?: View;
}) {
	let changed: Partial<View> | undefined;
	let revised: Chip[] | undefined;
	let focused = false;
	const state = emptyState({
		terms: args.terms ?? [],
		chips: parseChips(args.q ?? ""),
		tooWide: args.tooWide ?? false,
		withoutStrong: args.withoutStrong ?? 0,
		view: args.view ?? {},
		onChange: (next) => {
			changed = next;
		},
		onReviseQuery: (next) => {
			revised = next;
		},
		onFocusQuery: () => {
			focused = true;
		},
	});
	state.action.onClick();
	return { ...state, changed, revised, focused };
}

describe("词太宽", () => {
	test("这是一种结果，不是一次失败：给的是收窄的下一步", () => {
		const s = run({ terms: [must("运营")], q: "运营", tooWide: true });
		assert.match(s.title, /太多/);
		assert.equal(s.focused, true, "出口是去补一个条件");
		assert.equal(s.changed, undefined, "不该去动筛选——筛选不是病因");
	});

	test("排在最前：它和「筛选太窄」同时成立时，说的必须是宽", () => {
		const s = run({
			terms: [must("运营")],
			q: "运营",
			tooWide: true,
			view: { seq: "技术/后端" },
		});
		assert.match(s.title, /太多/);
	});
});

describe("没词可搜的三种成因", () => {
	test("条件全被停用：说的是停用，出口是一键开回来", () => {
		const s = run({ q: "~渠道运营,~+带团队" });
		assert.match(s.title, /没有启用/);
		assert.deepEqual(
			s.revised,
			[
				{ term: "渠道运营", mode: "must" },
				{ term: "带团队", mode: "boost" },
			],
			"启用要保住原来的强度",
		);
		assert.equal(s.changed, undefined, "改条件不是改视图");
	});

	test("停用的排除词不算数：它本来就不产出人", () => {
		const s = run({ q: "~-实习" });
		assert.equal(s.title, "缺少搜索条件");
	});

	test("只写了排除词：让人补一个要找的能力", () => {
		const s = run({ q: "-实习" });
		assert.equal(s.title, "缺少搜索条件");
		assert.equal(s.focused, true);
	});

	test("一个词都没解析出来：让人重写整句", () => {
		const s = run({ q: "帮我找一下" });
		assert.equal(s.title, "未识别到有效的搜索条件");
		assert.equal(s.focused, true);
	});
});

describe("有词但没人的三种成因", () => {
	test("证据要求滤空了：报出关掉之后能看到几个", () => {
		const s = run({
			terms: [must("算法")],
			q: "算法",
			withoutStrong: 12,
			view: { strong: true },
		});
		assert.match(s.hint, /12/);
		assert.deepEqual(s.changed, { strong: undefined });
	});

	test("筛选太窄：一键清筛选，但不动证据要求", () => {
		const s = run({
			terms: [must("算法")],
			q: "算法",
			view: { seq: "技术/后端" },
		});
		assert.equal(s.changed?.seq, undefined);
		assert.ok(!("strong" in (s.changed ?? {})), "证据要求不归「清除筛选」管");
	});

	test("什么都没筛还是空：指向把某个必须词改成加分", () => {
		const s = run({ terms: [must("算法")], q: "算法" });
		assert.match(s.hint, /加分/);
		assert.equal(s.focused, true);
	});
});
