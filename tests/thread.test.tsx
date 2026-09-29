/**
 * 右栏的线程：每一轮的需求、搜索条件怎么变了、替人定了什么理解方式、哪些要求没有采用。
 * 模型每一轮提交整张表，它丢掉的条件只在这里看得见。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { stepFindings, Thread } from "#/routes/s/$turnId/-components/thread";
import type { TurnNotes } from "#/search/intent";
import { parseQuery } from "#/search/query-syntax";
import type { TraceStep } from "#/search/trace";
import type { InterpretFault, Turn } from "#/server/turn";
import { visibleText } from "./render";
import { routed } from "./routed";

type Round = {
	said: string | null;
	spec: string | null;
	notes?: TurnNotes | null;
	trace?: TraceStep[] | null;
};

function turns(rounds: Round[]): Turn[] {
	return rounds.map((r, i) => ({
		id: `t${i}`,
		rootTurnId: "t0",
		mode: "conversation",
		title: rounds[0]?.said ?? null,
		said: r.said,
		spec: r.spec === null ? null : { conditions: parseQuery(r.spec) },
		notes: r.notes ?? null,
		trace: r.trace ?? null,
		at: 0,
	}));
}

/** 别的轮次底下有查看那一轮结果的 `Link`，得站在一个 router 里才画得出来。 */
async function seen(
	rounds: Round[],
	{
		understanding = true,
		waiting = false,
		liveTrace = null,
		fault = null,
		onRetry,
		viewing = rounds.length - 1,
	}: {
		understanding?: boolean;
		waiting?: boolean;
		liveTrace?: TraceStep[] | null;
		fault?: InterpretFault | null;
		onRetry?: () => void;
		/** 名单正显示第几轮，默认最后一轮。 */
		viewing?: number;
	} = {},
) {
	const html = await routed(
		() => (
			<Thread
				fault={fault}
				liveTrace={liveTrace}
				onAdd={() => {}}
				onQuery={() => true}
				onRetry={onRetry}
				rounds={turns(rounds)}
				understanding={understanding}
				viewing={`t${viewing}`}
				waiting={waiting}
			/>
		),
		{ path: "/s/$turnId", url: "/s/t9" },
	);
	return { text: visibleText(html), html };
}

describe("后面每一轮", () => {
	test("复述那段需求，说出添加了什么、移除了什么", async () => {
		const { text } = await seen([
			{ said: "算法，最好字节的", spec: "算法, +org:字节" },
			{ said: "再加上带过团队的，不用非得是字节", spec: "算法, 带团队" },
		]);
		assert.match(text, /再加上带过团队的，不用非得是字节/);
		assert.match(text, /已添加 带团队；已移除 字节（加分）/);
	});

	test("条件没动也说出来：不是没反应", async () => {
		const { text } = await seen([
			{ said: "算法", spec: "算法" },
			{ said: "就这样", spec: "算法" },
		]);
		assert.match(text, /搜索条件未变/);
	});

	test("还在理解时只有那段需求和进行中，不猜变化", async () => {
		const { text } = await seen(
			[
				{ said: "算法", spec: "算法" },
				{ said: "再资深一点", spec: null },
			],
			{ waiting: true },
		);
		assert.match(text, /再资深一点/);
		assert.match(text, /正在理解你的需求/);
		assert.doesNotMatch(text, /已添加|已移除|未变/);
	});

	test("没理解出来就记下是哪一环坏了，不装作还在进行，也不怪这段描述", async () => {
		const { text } = await seen(
			[
				{ said: "算法", spec: "算法" },
				{ said: "再资深一点", spec: null },
			],
			{ fault: "unreachable" },
		);
		assert.match(text, /AI 服务暂时不可用/);
		assert.doesNotMatch(text, /正在理解|没能理解/);
	});

	test("能重试的那一环在提示上给重试，没开启 AI 搜索时不给", async () => {
		const rounds = [{ said: "再资深一点", spec: null }];
		const retry = { onRetry: () => {} };
		const down = await seen(rounds, { fault: "unreachable", ...retry });
		assert.match(down.text, /AI 服务暂时不可用\s*重试/);
		const off = await seen(rounds, { fault: "unconfigured", ...retry });
		assert.match(off.text, /AI 搜索未开启/);
		assert.doesNotMatch(off.text, /重试/);
	});

	test("直接改条件的一轮没有人说话，只记改了什么", async () => {
		const { text } = await seen([
			{ said: "算法，带团队", spec: "算法, 带团队" },
			{ said: null, spec: "算法" },
		]);
		assert.match(text, /你修改了搜索条件：移除 带团队/);
	});
});

describe("第一轮", () => {
	test("说出按哪几条条件搜索", async () => {
		const { text } = await seen([{ said: "算法和后端", spec: "算法, 后端" }]);
		assert.match(text, /算法和后端/);
		assert.match(text, /已按以下条件搜索：算法、后端/);
	});

	test("理解方式和未采用的要求都写出来，有替代就在那次回应底下给一键添加", async () => {
		const { text } = await seen([
			{
				said: "北京的算法，有潜力",
				spec: "算法",
				notes: {
					assumed: ["「算法」按算法工程方向理解"],
					declined: [
						{ said: "北京的", why: "暂不支持按工作地点筛选", instead: [] },
						{
							said: "有潜力",
							why: "简历中看不出潜力",
							instead: parseQuery("+带团队"),
						},
					],
				},
			},
		]);
		assert.match(text, /「算法」按算法工程方向理解/);
		assert.match(text, /未采用「北京的」：\s*暂不支持按工作地点筛选/);
		assert.match(text, /未采用「有潜力」：\s*简历中看不出潜力/);
		assert.match(text, /把「有潜力」换成 带团队（加分）/);
		assert.doesNotMatch(text, /把「北京的」换成/, "没有替代就不给");
	});
});

describe("线程就是记录链", () => {
	const declined: TurnNotes = {
		assumed: [],
		declined: [
			{ said: "有潜力", why: "看不出", instead: parseQuery("+带团队") },
		],
	};
	const chain: Round[] = [
		{ said: "算法，有潜力", spec: "算法", notes: declined },
		{ said: "再加后端", spec: "算法, 后端" },
	];

	test("别的轮次能查看当时的结果，正看着的最后一轮不是链接", async () => {
		const { html, text } = await seen(chain);
		assert.match(html, /href="\/s\/t0"/, "第一轮能点过去");
		assert.doesNotMatch(html, /href="\/s\/t1"/, "正看着的这一轮不是链接");
		assert.match(html, /aria-current="page"/);
		assert.doesNotMatch(text, /正在查看/, "看着最后一轮是默认的样子，不标");
		assert.match(text, /未采用「有潜力」：\s*看不出/);
		assert.doesNotMatch(text, /换成/, "替代条件跟着正看着的那一轮");
	});

	test("回头看早先一轮：后面的轮次都还在，那一轮标出正在查看", async () => {
		const { html, text } = await seen(chain, { viewing: 0 });
		assert.match(text, /再加后端/, "后面那一轮没有被藏起来");
		assert.match(html, /href="\/s\/t1"/, "最后一轮能点回去");
		assert.doesNotMatch(html, /href="\/s\/t0"/);
		assert.match(text, /正在查看/);
		assert.match(
			text,
			/把「有潜力」换成 带团队（加分）/,
			"替代条件作用在正看着的那一轮上",
		);
	});

	test("AI 搜索没开启就没有输入框", async () => {
		const with_ = await seen([{ said: "算法", spec: "算法" }]);
		const without = await seen([{ said: "算法", spec: "算法" }], {
			understanding: false,
		});
		assert.match(with_.html, /补充或修改需求/);
		assert.doesNotMatch(without.html, /补充或修改需求/);
	});
});

describe("检索人才库的过程", () => {
	const trace: TraceStep[] = [
		{
			at: 1,
			tool: "find_terms",
			terms: [
				{
					text: "推荐",
					people: 128,
					wide: false,
					terms: [{ name: "推荐算法", people: 96 }],
				},
				{ text: "互联网", people: 900, wide: true, terms: [] },
				{ text: "量子炼金", people: 0, wide: false, terms: [] },
			],
		},
		{
			at: 1,
			tool: "find_names",
			field: "org",
			names: [
				{ name: "星河", people: 44, names: [{ name: "星河科技", people: 38 }] },
			],
		},
		{
			at: 2,
			tool: "find_names",
			field: "school",
			names: [{ name: "银河学院", people: 0, names: [] }],
		},
	];

	test("完成后收起，标题只说走了几步", async () => {
		const { text } = await seen([
			{ said: "推荐和后端", spec: "推荐算法, 后端", trace },
		]);
		assert.match(text, /检索人才库 3 步/);
		assert.doesNotMatch(text, /查找公司/, "每一步收在里面");
	});

	test("进行中摊开，每一步一行：动作、对象；结论收在这一步里面", async () => {
		const { text } = await seen([{ said: "推荐和后端", spec: null }], {
			waiting: true,
			liveTrace: trace,
		});
		assert.match(text, /检索人才库 3 步/);
		assert.match(text, /查找\s*推荐、互联网、量子炼金/);
		assert.match(text, /查找公司\s*星河/);
		assert.match(text, /查找学校\s*银河学院/);
		assert.doesNotMatch(text, /\d+ 人/, "结论点开这一步才看得见");
		assert.doesNotMatch(text, /正在理解你的需求/, "有了步骤就不再说在理解");
	});

	test("一步的结论：一个说法多少人、范围大不大、包括哪些技能；一个名字匹配到哪些", () => {
		assert.deepEqual(stepFindings(trace[0] as TraceStep), [
			"「推荐」128 人，包括推荐算法 96 人",
			"「互联网」900 人，范围较大",
			"人才库中没有「量子炼金」",
		]);
		assert.deepEqual(stepFindings(trace[1] as TraceStep), [
			"「星河」44 人，包括星河科技 38 人",
		]);
		assert.deepEqual(stepFindings(trace[2] as TraceStep), [
			"人才库中没有「银河学院」",
		]);
	});

	test("查看结果是一枚带名字的图标链接，不包任何动作", async () => {
		const { html } = await seen([
			{ said: "推荐和后端", spec: "推荐算法, 后端", trace },
			{ said: "再加带团队", spec: "推荐算法, 后端, 带团队" },
		]);
		assert.doesNotMatch(html, /<a[^>]*>(?:(?!<\/a>)[\s\S])*<button/);
		const link = /<a[^>]*href="\/s\/t0"[^>]*>/.exec(html);
		assert.match(link?.[0] ?? "", /aria-label="查看这次的结果"/);
	});
});
