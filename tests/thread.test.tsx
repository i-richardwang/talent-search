/**
 * 右栏的线程：每一轮的需求、搜索条件怎么变了、AI 对 HR 说了什么、问了什么。
 * 模型每一轮提交整张表，它丢掉的条件只在这里看得见。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { internalWordsIn } from "#/lib/internal-words";
import {
	answerAt,
	stepFindings,
	Thread,
} from "#/routes/s/$turnId/-components/thread";
import { compileConditions } from "#/search/compile";
import type { TurnNotes } from "#/search/intent";
import { parseQuery } from "#/search/query-syntax";
import type { TraceStep } from "#/search/trace";
import type { AttemptFault, Progress, Turn } from "#/server/turn";
import { visibleText } from "./render";
import { routed } from "./routed";

type Round = {
	said: string | null;
	spec: string | null;
	notes?: TurnNotes | null;
	trace?: TraceStep[] | null;
	/** AI 处理完了没有；不写时看有没有条件：说了话的一轮，条件写下就是处理完了。 */
	settled?: boolean;
};

function turns(rounds: Round[]): Turn[] {
	return rounds.map((r, i) => ({
		id: `t${i}`,
		rootTurnId: "t0",
		mode: "conversation",
		title: rounds[0]?.said ?? null,
		said: r.said,
		spec:
			r.spec === null ? null : { query: compileConditions(parseQuery(r.spec)) },
		notes: r.notes ?? null,
		trace: r.trace ?? null,
		startedAt: null,
		fault: null,
		settled: r.settled ?? r.spec !== null,
		at: 0,
	}));
}

/** 别的轮次底下有查看那一轮结果的 `Link`，得放在一个 router 里才画得出来。 */
async function seen(
	rounds: Round[],
	{
		understanding = true,
		waiting = false,
		progress = null,
		fault = null,
		onRetry = () => {},
		viewing = rounds.length - 1,
	}: {
		understanding?: boolean;
		waiting?: boolean;
		progress?: Progress | null;
		fault?: AttemptFault | null;
		onRetry?: () => void;
		/** 名单正显示第几轮，默认最后一轮。 */
		viewing?: number;
	} = {},
) {
	const chain = turns(rounds);
	const latest = chain.pop();
	assert.ok(latest, "至少一轮");
	const html = await routed(
		() => (
			<Thread
				earlier={chain}
				fault={fault}
				latest={latest}
				onAnswer={() => true}
				onQuery={() => true}
				onRetry={onRetry}
				progress={progress}
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
			{ said: "算法，最好字节的", spec: "算法, +company:字节" },
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

	test("没理解出来就记下是哪个环节出了问题，不装作还在进行，也不怪这段描述", async () => {
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

	test("AI 说的那句话写在回应里", async () => {
		const { text } = await seen([
			{
				said: "北京的算法",
				spec: "算法",
				notes: { says: "人才库里没有工作地点，这条先没管。", choices: null },
			},
		]);
		assert.match(
			text,
			/已按以下条件搜索：算法\s*人才库里没有工作地点，这条先没管。/,
		);
	});
});

const ASKED: TurnNotes = {
	says: "简历里看不出潜力，要不要先看带过团队的？",
	choices: {
		current: "先不管这条",
		others: [
			{ label: "带过团队的优先", detail: "写过带团队的有两百多位" },
			{ label: "只看带过团队的" },
		],
	},
};

describe("AI 问的那一问", () => {
	test("最后一轮的问题可以选：现在用的那一项标当前、不能点，其余每句回答是一个按钮", async () => {
		const { html, text } = await seen([
			{ said: "算法，有潜力", spec: "算法", notes: ASKED },
		]);
		assert.match(text, /要不要先看带过团队的？/);
		assert.match(text, /1\s*先不管这条\s*当前/);
		assert.match(text, /2\s*带过团队的优先\s*写过带团队的有两百多位/);
		assert.match(text, /3\s*只看带过团队的/);
		for (const answer of ["带过团队的优先", "只看带过团队的"])
			assert.match(
				html,
				new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*${answer}`),
			);
		assert.doesNotMatch(
			html,
			/<button[^>]*>(?:(?!<\/button>)[\s\S])*先不管这条/,
			"现在用的那一项已经生效，点它什么都不会发生",
		);
	});

	test("选第几项就是说哪句回答：编号和选项前的一样，第 1 项是现在这一种，不用再说", () => {
		const choices = ASKED.choices;
		assert.ok(choices);
		assert.equal(answerAt(choices, 1), null);
		assert.equal(answerAt(choices, 2), "带过团队的优先");
		assert.equal(answerAt(choices, 3), "只看带过团队的");
		assert.equal(answerAt(choices, 4), null);
		assert.equal(answerAt(choices, Number.NaN), null);
	});

	test("有了下一轮就收起来：下一轮说的正是其中一句回答，问话底下写出答的是哪一句", async () => {
		const { html, text } = await seen([
			{ said: "算法，有潜力", spec: "算法", notes: ASKED },
			{ said: "带过团队的优先", spec: "算法, +带团队" },
		]);
		assert.match(text, /要不要先看带过团队的？\s*带过团队的优先/);
		assert.doesNotMatch(text, /先不管这条|只看带过团队的|两百多位/);
		assert.doesNotMatch(html, /<button[^>]*class="ui-question-option"/);
	});

	test("接着说了别的话，或者直接改了条件：只留问话", async () => {
		for (const next of [
			{ said: "再加后端", spec: "算法, 后端" },
			{ said: null, spec: "算法, +带团队" },
		]) {
			const { html, text } = await seen([
				{ said: "算法，有潜力", spec: "算法", notes: ASKED },
				next,
			]);
			assert.match(text, /要不要先看带过团队的？/);
			assert.doesNotMatch(text, /带过团队的优先|先不管这条/);
			assert.doesNotMatch(html, /ui-question-answer"/);
		}
	});
});

describe("线程就是记录链", () => {
	const chain: Round[] = [
		{ said: "算法，有潜力", spec: "算法" },
		{ said: "再加后端", spec: "算法, 后端" },
	];

	test("别的轮次能查看当时的结果，正看着的最后一轮不是链接", async () => {
		const { html, text } = await seen(chain);
		assert.match(html, /href="\/s\/t0"/, "第一轮能点过去");
		assert.doesNotMatch(html, /href="\/s\/t1"/, "正看着的这一轮不是链接");
		assert.match(html, /aria-current="page"/);
		assert.doesNotMatch(text, /正在查看/, "看着最后一轮是默认的样子，不标");
	});

	test("回头看早先一轮：后面的轮次都还在，那一轮标出正在查看", async () => {
		const { html, text } = await seen(chain, { viewing: 0 });
		assert.match(text, /再加后端/, "后面那一轮没有被藏起来");
		assert.match(html, /href="\/s\/t1"/, "最后一轮能点回去");
		assert.doesNotMatch(html, /href="\/s\/t0"/);
		assert.match(text, /正在查看/);
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
			tool: "find",
			found: [
				{ phrases: 12, top: ["推荐算法", "推荐系统"] },
				{ phrases: 0, top: [] },
			],
		},
		{
			at: 1,
			tool: "discover",
			discovery: {
				kind: "names",
				subject: "公司",
				found: [{ query: "星河", values: ["星河科技"] }],
			},
		},
		{
			at: 2,
			tool: "discover",
			discovery: {
				kind: "names",
				subject: "学校",
				found: [{ query: "银河学院", values: [] }],
			},
		},
		{
			at: 3,
			tool: "discover",
			discovery: {
				kind: "values",
				subject: "学历",
				values: ["本科", "硕士"],
			},
		},
	];

	test("完成后收起，标题只说走了几步", async () => {
		const { text } = await seen([
			{ said: "推荐和后端", spec: "推荐算法, 后端", trace },
		]);
		assert.match(text, /检索人才库 4 步/);
		assert.doesNotMatch(text, /查找公司/, "每一步收在里面");
	});

	test("提交没通过的那一步：标题和结论里都没有内部用词，说法要改的那条不点名", async () => {
		const { text } = await seen([{ said: "推荐", spec: null }], {
			waiting: true,
			progress: {
				trace: [
					{
						at: 1,
						tool: "submit",
						issues: [
							{ kind: "wording", subject: null },
							{ kind: "unfound", subject: "量子炼金" },
						],
					},
				],
				startedAt: null,
			},
		});
		assert.match(text, /调整搜索条件\s*量子炼金/);
		assert.deepEqual(internalWordsIn(text), []);
	});

	test("进行中展开，每一步一行：动作、对象；结论收在这一步里面", async () => {
		const { text } = await seen([{ said: "推荐和后端", spec: null }], {
			waiting: true,
			progress: { trace, startedAt: null },
		});
		assert.match(text, /检索人才库 4 步/);
		assert.match(text, /查看人才库里的说法/);
		assert.doesNotMatch(text, /推荐\(算法/, "找的时候用的写法不上屏");
		assert.match(text, /查找公司\s*星河/);
		assert.match(text, /查找学校\s*银河学院/);
		assert.match(text, /查看学历/);
		assert.doesNotMatch(text, /人才库中/, "结论点开这一步才看得见");
		assert.doesNotMatch(text, /正在理解你的需求/, "有了步骤就不再说在理解");
	});

	test("一步的结论：人才库里有没有、包括哪些写法，不写全库人数", () => {
		assert.deepEqual(stepFindings(trace[0] as TraceStep), [
			"人才库中有推荐算法、推荐系统等 12 种说法",
		]);
		assert.deepEqual(stepFindings(trace[1] as TraceStep), [
			"人才库中有「星河」，包括星河科技",
		]);
		assert.deepEqual(stepFindings(trace[2] as TraceStep), [
			"人才库中没有「银河学院」",
		]);
		assert.deepEqual(stepFindings(trace[3] as TraceStep), ["本科、硕士"]);
	});

	test("看人才库概况：只说有哪些记录、从什么时候起，不写人数", () => {
		const facts = stepFindings({
			at: 0,
			tool: "discover",
			discovery: {
				kind: "overview",
				streams: [{ label: "绩效", first: "2023-01-01" }],
			},
		});
		assert.deepEqual(facts, ["人才库中有绩效记录，2023-01-01 起"]);
	});

	test("提交没通过：说哪一条还要改、为什么，用 HR 读得懂的话", () => {
		const findings = stepFindings({
			at: 0,
			tool: "submit",
			issues: [
				{ kind: "form", subject: null },
				{ kind: "wording", subject: null },
				{ kind: "unrunnable", subject: "近三年两次 A" },
				{ kind: "unfound", subject: "量子炼金" },
				{ kind: "tooBroad", subject: "做过开发" },
				{ kind: "unread", subject: null },
			],
		});
		assert.deepEqual(findings, [
			"有的搜索条件没写完整",
			"有一条的说法要换成更直白的话",
			"「近三年两次 A」这样写搜不了",
			"人才库中没有「量子炼金」",
			"「做过开发」找出的太多，名单出不来",
			"还有候选人没确认完",
		]);
		assert.deepEqual(internalWordsIn(findings.join("")), []);
	});

	test("读经历、下结论各是一步：标题说在做什么，结论说取了几段、后面还有几段、几段符合几段不符合", async () => {
		const steps: TraceStep[] = [
			{ at: 1, tool: "read", segments: 80, left: 130 },
			{ at: 2, tool: "judge", fits: 31, unfit: 49 },
			{ at: 3, tool: "read", segments: 50, left: 50 },
			{ at: 4, tool: "judge", fits: 0, unfit: 50 },
		];
		assert.deepEqual(steps.map(stepFindings), [
			["取了 80 段经历，后面还有 50 段"],
			["31 段符合，49 段不符合"],
			["取了 50 段经历"],
			["0 段符合，50 段不符合"],
		]);
		assert.deepEqual(
			[
				{ at: 5, tool: "read", segments: 0, left: 0 } as const,
				{ at: 6, tool: "read", segments: 0, left: 40 } as const,
				{ at: 7, tool: "read", unlisted: true } as const,
				{ at: 8, tool: "judge", redo: true } as const,
			].map(stepFindings),
			[
				["候选人的经历都确认过了"],
				["这一次能确认的经历已经到上限"],
				["这份条件还出不了名单"],
				["这一批要重新判断"],
			],
		);
		const { text } = await seen([{ said: "做风控策略的", spec: null }], {
			waiting: true,
			progress: { trace: steps, startedAt: null },
		});
		assert.match(text, /检索人才库 4 步/);
		assert.match(
			text,
			/查看候选人的经历\s*判断这些经历是否符合\s*查看候选人的经历\s*判断这些经历是否符合/,
		);
		assert.deepEqual(internalWordsIn(text), []);
		assert.deepEqual(internalWordsIn(steps.flatMap(stepFindings).join("")), []);
	});

	describe("直接改条件的一轮", () => {
		const steps: TraceStep[] = [
			{ at: 1, tool: "read", segments: 40, left: 40 },
			{ at: 2, tool: "judge", fits: 12, unfit: 28 },
		];
		const edited = (over: Partial<Round> = {}): Round[] => [
			{ said: "做推荐的", spec: "推荐算法" },
			{ said: null, spec: "推荐算法, 后端", ...over },
		];

		test("AI 接着补人：分隔线下面是检索过程，进行中展开，做完收起；不用 AI 处理的一轮没有过程", async () => {
			const running = await seen(edited({ settled: false }), {
				progress: { trace: steps, startedAt: null },
			});
			assert.match(running.text, /你修改了搜索条件：添加 后端/);
			assert.match(
				running.text,
				/检索人才库 2 步\s*查看候选人的经历\s*判断这些经历是否符合/,
			);
			assert.doesNotMatch(running.text, /正在理解你的需求/);
			assert.deepEqual(internalWordsIn(running.text), []);

			const done = await seen(edited({ trace: steps }));
			assert.match(done.text, /检索人才库 2 步/);
			assert.doesNotMatch(done.text, /查看候选人的经历/);

			const plain = await seen(edited());
			assert.doesNotMatch(plain.text, /检索人才库/);
		});

		test("补人没成：这一轮底下说哪个环节出了问题，给重试", async () => {
			const { text } = await seen(edited({ settled: false }), {
				fault: "unreachable",
				progress: { trace: [], startedAt: null },
			});
			assert.match(text, /你修改了搜索条件：添加 后端/);
			assert.match(text, /AI 服务暂时不可用/);
			assert.match(text, /重试/);
		});
	});

	describe("试搜", () => {
		const probed = (probe: Extract<TraceStep, { tool: "probe" }>["probe"]) =>
			stepFindings({ at: 0, tool: "probe", probe });
		const must = { mode: "must" as const };

		test("每条单独搜到几个人；有一条写不对时说搜不了，不写合起来的人数", () => {
			assert.deepEqual(
				probed({
					conditions: [
						{ ...must, label: "做过推荐", people: 12 },
						{ ...must, label: "近三年两次 A", people: null },
					],
					total: null,
					candidates: null,
					unread: 0,
				}),
				["做过推荐：搜到 12 人", "近三年两次 A：这样写搜不了"],
			);
		});

		test("经历都确认过了：合起来写符合的人数；排除和 chip 上一样标出来", () => {
			assert.deepEqual(
				probed({
					conditions: [
						{ ...must, label: "做过推荐", people: 20 },
						{ label: "做过销售", mode: "exclude", people: 2 },
					],
					total: 12,
					candidates: 12,
					unread: 0,
				}),
				[
					"做过推荐：搜到 20 人",
					"做过销售（排除）：搜到 2 人",
					"合起来：12 人符合",
				],
			);
		});

		test("还没确认完：写候选多少人，已确认的里面有人时接着写符合的人数，不把没确认的人说成符合", () => {
			const conditions = [
				{ ...must, label: "做过推荐", people: 40 },
				{ ...must, label: "硕士及以上", people: 300 },
			];
			const each = ["做过推荐：搜到 40 人", "硕士及以上：搜到 300 人"];
			const unseen = probed({
				conditions,
				total: 0,
				candidates: 30,
				unread: 37,
			});
			assert.deepEqual(unseen, [...each, "合起来：候选 30 人，还没确认完"]);
			const partly = probed({
				conditions,
				total: 2,
				candidates: 30,
				unread: 20,
			});
			assert.deepEqual(partly, [
				...each,
				"合起来：候选 30 人，还没确认完，已确认 2 人符合",
			]);
			assert.deepEqual(internalWordsIn([...unseen, ...partly].join("")), []);
		});

		test("字面一个都对不上的条件写搜到 0 人，不说成还没确认", () => {
			assert.deepEqual(
				probed({
					conditions: [{ ...must, label: "量子炼金", people: 0 }],
					total: 0,
					candidates: 0,
					unread: 0,
				}),
				["量子炼金：搜到 0 人", "合起来：0 人符合"],
			);
		});
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
