/**
 * 右栏的线程：每一轮说了什么、条件怎么变了、替人定了什么读法、哪些要求搜不了。
 * 模型每一轮交回整张表，它丢掉的条件只在这里看得见。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { Thread } from "#/routes/s/$turnId/-components/thread";
import type { TurnNotes } from "#/search/intent";
import { parseQuery } from "#/search/query-syntax";
import type { TraceStep } from "#/search/trace";
import type { Turn } from "#/server/turn";
import { visibleText } from "./render";

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
	}));
}

/** 过去的一轮那句话是 `Link`，得站在一个 router 里才画得出来。 */
async function seen(rounds: Round[], understanding = true) {
	const root = createRootRoute();
	const page = createRoute({
		getParentRoute: () => root,
		path: "/s/$turnId",
		component: () => (
			<Thread
				onAdd={() => {}}
				onQuery={() => true}
				rounds={turns(rounds)}
				understanding={understanding}
				waiting={false}
			/>
		),
	});
	const router = createRouter({
		routeTree: root.addChildren([page]),
		history: createMemoryHistory({ initialEntries: ["/s/t9"] }),
	});
	await router.load();
	return {
		text: visibleText(renderToStaticMarkup(<RouterProvider router={router} />)),
		html: renderToStaticMarkup(<RouterProvider router={router} />),
	};
}

describe("接着说的一轮", () => {
	test("复述那句话，说出加了什么、去掉了什么", async () => {
		const { text } = await seen([
			{ said: "算法，最好字节的", spec: "算法, +org:字节" },
			{ said: "再加上带过团队的，不用非得是字节", spec: "算法, 带团队" },
		]);
		assert.match(text, /再加上带过团队的，不用非得是字节/);
		assert.match(text, /加上 带团队，去掉 \+字节/);
	});

	test("条件没动也说出来：不是没反应", async () => {
		const { text } = await seen([
			{ said: "算法", spec: "算法" },
			{ said: "就这样", spec: "算法" },
		]);
		assert.match(text, /条件没有变化/);
	});

	test("还在整理时只有那句话，不猜变化", async () => {
		const { text } = await seen([
			{ said: "算法", spec: "算法" },
			{ said: "再资深一点", spec: null },
		]);
		assert.match(text, /再资深一点/);
		assert.doesNotMatch(text, /加上|去掉|没有变化/);
	});

	test("直接在 chip 上改的一轮没有话，只记那一步改了什么", async () => {
		const { text } = await seen([
			{ said: "算法，带团队", spec: "算法, 带团队" },
			{ said: null, spec: "算法" },
		]);
		assert.match(text, /去掉 带团队/);
	});
});

describe("链头那一轮", () => {
	test("说出读成了哪几条条件", async () => {
		const { text } = await seen([{ said: "算法和后端", spec: "算法, 后端" }]);
		assert.match(text, /算法和后端/);
		assert.match(text, /算法、后端/);
	});

	test("读法和搜不了的要求都写出来，有替代就给一键加上", async () => {
		const { text } = await seen([
			{
				said: "北京的算法，有潜力",
				spec: "算法",
				notes: {
					assumed: ["「算法」按算法工程方向读"],
					declined: [
						{ said: "北京的", why: "库里没有工作地点", instead: [] },
						{
							said: "有潜力",
							why: "经历里看不出潜力",
							instead: parseQuery("+带团队"),
						},
					],
				},
			},
		]);
		assert.match(text, /「算法」按算法工程方向读/);
		assert.match(text, /「北京的」搜不了：库里没有工作地点/);
		assert.match(text, /「有潜力」搜不了：经历里看不出潜力 加上 \+带团队/);
	});
});

describe("线程就是记录链", () => {
	test("过去的一轮是回到那一轮的链接，当前这一轮不是；「加上」只在当前一轮", async () => {
		const declined: TurnNotes = {
			assumed: [],
			declined: [
				{ said: "有潜力", why: "看不出", instead: parseQuery("+带团队") },
			],
		};
		const { html, text } = await seen([
			{ said: "算法，有潜力", spec: "算法", notes: declined },
			{ said: "再加后端", spec: "算法, 后端" },
		]);
		assert.match(html, /href="\/s\/t0"/, "链头那一轮能点回去");
		assert.doesNotMatch(html, /href="\/s\/t1"/, "当前这一轮不是链接");
		assert.match(html, /aria-current="step"/);
		assert.match(text, /「有潜力」搜不了：看不出/);
		assert.doesNotMatch(text, /加上 \+带团队/, "过去那一轮不给一键加上");
	});

	test("没配查询理解就没有接着说的框", async () => {
		const with_ = await seen([{ said: "算法", spec: "算法" }]);
		const without = await seen([{ said: "算法", spec: "算法" }], false);
		assert.match(with_.html, /接着说/);
		assert.doesNotMatch(without.html, /接着说/);
	});
});

describe("模型走过的步骤", () => {
	const trace: TraceStep[] = [
		{
			at: 1,
			tool: "look_up_words",
			words: [
				{ word: "推荐", canonical: "推荐算法", people: 128, wide: false },
				{ word: "互联网", canonical: "互联网", people: 900, wide: true },
				{ word: "量子炼金", canonical: null, people: 0, wide: false },
			],
		},
		{
			at: 2,
			tool: "try_conditions",
			conditions: parseQuery("推荐算法, 后端"),
			total: 42,
			empty: null,
		},
		{
			at: 3,
			tool: "try_conditions",
			conditions: parseQuery("推荐算法, 后端, 量子炼金"),
			total: 0,
			empty: "unmet",
		},
	];

	test("每一步说成一句：查了什么词、库里叫什么、多少人、宽不宽；试搜出多少人", async () => {
		const { text } = await seen([
			{ said: "推荐和后端", spec: "推荐算法, 后端", trace },
		]);
		assert.match(
			text,
			/查词：推荐→推荐算法（128 人）、互联网（900 人，太宽）、量子炼金（词表里没有）/,
		);
		assert.match(text, /试搜：推荐算法、后端 → 42 人/);
		assert.match(text, /试搜：推荐算法、后端、量子炼金 → 没有人/);
	});

	test("过去的一轮把过程收起来，只说几步", async () => {
		const { html } = await seen([
			{ said: "推荐和后端", spec: "推荐算法, 后端", trace },
			{ said: "再加带团队", spec: "推荐算法, 后端, 带团队" },
		]);
		assert.match(html, /过程 · 3 步/);
		// 过去的一轮只有那句话是链接：折叠过程的按钮是动作，不能住在链接里
		assert.doesNotMatch(html, /<a[^>]*>(?:(?!<\/a>)[\s\S])*<button/);
		assert.match(html, /<a[^>]*href="\/s\/t0"[^>]*>推荐和后端<\/a>/);
	});
});
