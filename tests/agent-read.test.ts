/**
 * 读经历（`server/reading.ts`，经查询理解的 `read` 工具），和提交前「候选人的经历读完没有」的
 * 检查。跑在临时 schema 上的真 SQL，不经过模型：直接按工具的入参调，每一批算不算由用例自己给。
 * 数据全是合成的。每个用例是一次自己的找人任务：结论记在它名下，也只认它名下的。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { TraceStep } from "#/search/trace";
import type { Judge, RecordStep } from "#/server/reading";
import {
	agentOn,
	answeringScores,
	type Checked,
	conclude,
	fitsWhere,
	judged,
	openSearch,
	type Read,
	seed,
	setup,
	type Tried,
	table,
} from "./fixture";

/** 按字节装批只在设了上限时生效；这里设上，长原文的用例才分得出批。 */
const BATCH_BYTES = 65536;
process.env.LLM_READ_BATCH_BYTES = String(BATCH_BYTES);

const teardown = await setup();
after(teardown);

const { READ_BATCH, segmentBatches } = await import("#/server/segment-batches");
const { READ_MAX } = await import("#/server/reading");
const { criterionKey } = await import("#/search/verdict");
const { execute, probe } = await import("#/search/execute");
const { db, pool } = await import("#/db");
const record: RecordStep = async (_step, persist) => {
	await persist?.(db);
};

/** 一批读不完、一轮读得完的那一组有多少人。 */
const MANY = READ_BATCH + 40;
/** 一轮读不完的那一组有多少人；其中职级高的 `LEADS` 个。 */
const TOO_MANY = READ_MAX + 10;
const LEADS = 20;

const numbered = (prefix: string, n: number) =>
	Array.from({ length: n }, (_, i) => `${prefix}${i}`);

before(async () => {
	await seed([
		{
			personId: "XJ01",
			name: "合成巡检甲",
			curLevel: "P5",
			segments: [
				{
					months: 36,
					department: "设备部",
					departmentPath: "制造中心/设备部",
					seqL1: "生产",
					seqL2: "设备",
					title: "巡检组长",
					description: "带一个班组做产线设备巡检",
					extracted: { skills: [{ text: "设备巡检", engagement: "主导" }] },
				},
			],
		},
		{
			personId: "XJ02",
			name: "合成巡检乙",
			curLevel: "P7",
			segments: [
				{
					kind: "external",
					months: 24,
					company: "乙未机械",
					title: "巡检员",
					description: "负责夜班巡检",
				},
			],
		},
		{
			personId: "XJ03",
			name: "合成巡检丙",
			segments: [
				{
					kind: "external",
					months: 12,
					company: "丙申商贸",
					title: "巡检设备销售",
				},
			],
		},
		...["A", "B"].map((id) => ({
			personId: `PZ${id}`,
			name: `合成配载${id}`,
			segments: [{ months: 24, title: `配载员${id}` }],
		})),
		...numbered("CC", MANY).map((personId) => ({
			personId,
			name: `合成${personId}`,
			segments: [{ months: 24, title: "叉车调度" }],
		})),
		...numbered("ZP", TOO_MANY).map((personId, i) => ({
			personId,
			name: `合成${personId}`,
			curLevel: i < LEADS ? "P8" : "P5",
			segments: [{ months: 12, title: i < LEADS ? "装配班长" : "装配工" }],
		})),
	]);
});

/** 模型会写的一条带判据的经历条件：新写的，不带 id。 */
const seeking = (
	label: string,
	patterns: string[],
	criterion: string,
	over: Record<string, unknown> = {},
) => ({
	label,
	mode: "must",
	from: "experience",
	seek: { criterion, patterns },
	where: "true",
	...over,
});

/** 开一次找人任务，连同在它里面调的一套工具；`judge` 是读一批经历时哪些段算，默认都算。 */
async function agent(judge?: Judge) {
	const search = await openSearch();
	return { ...(await agentOn(search, [], judge)), search };
}

/** 这次找人任务里一条判据下存了哪些结论。 */
async function saved(search: string, criterion: string) {
	const { rows } = await pool.query<{ fits: boolean }>(
		"select fits from experience_verdict where root_turn_id = $1 and criterion_key = $2 order by fits desc",
		[search, criterionKey(criterion)],
	);
	return rows.map((row) => row.fits);
}
const plain = (steps: TraceStep[]) => steps.map(({ at: _at, ...step }) => step);

test("经历分批以请求 JSON 的实际字节为界，恰好装满的批次保留完整原文", () => {
	const header = { criterion: "负责配载" };
	const input = Array.from({ length: 10 }, () => ({ text: '中文"\n' }));
	const size = () =>
		Buffer.byteLength(
			JSON.stringify({
				...header,
				segments: input.map(({ text }, i) => ({ n: i + 1, text })),
			}),
		);
	const last = input.at(-1);
	assert.ok(last);
	last.text += "x".repeat(BATCH_BYTES - size());
	assert.equal(size(), BATCH_BYTES);
	const batches = [...segmentBatches(header, [...input, { text: "下一段" }])];
	assert.deepEqual(
		batches.map(({ entries }) => entries.length),
		[10, 1],
	);
	assert.deepEqual(batches[1]?.batch.segments, [{ n: 1, text: "下一段" }]);
});

test("同一任务里相同的证据文字跨轮沿用匹配分，即使文字相同，否决仍是无分", async () => {
	const { scoreEvidence } = await import("#/server/scoring");
	const root = await openSearch();
	const criterion = "承担叉车调度工作";
	const q = { conditions: [judged("调度", ["叉车调度"], criterion)] };
	const score = () => scoreEvidence(q, root, record);
	await conclude(root, criterion, true, ["CC0"]);
	await conclude(root, criterion, false, ["CC2"]);
	await answeringScores(
		(segments) => ({ scores: segments.map(({ n }) => ({ n, score: 73 })) }),
		score,
	);
	await conclude(root, criterion, true, ["CC1"]);
	let calls = 0;
	await answeringScores(() => {
		calls++;
		return { scores: [] };
	}, score);
	assert.equal(calls, 0);
	const { rows } = await pool.query(
		"select fits, match_score from experience_verdict where root_turn_id = $1 order by fits",
		[root],
	);
	assert.deepEqual(rows, [
		{ fits: false, match_score: null },
		{ fits: true, match_score: 73 },
		{ fits: true, match_score: 73 },
	]);
});

test("已入围者按匹配分排序，待确认的加分经历仍按相同顺序读取", async () => {
	const root = await openSearch();
	const criterion = "本人做配载";
	const query = {
		conditions: [
			judged("配载", ["配载员"], criterion),
			judged("复核", ["配载员"], "本人复核配载方案", { mode: "boost" }),
		],
	};
	await conclude(root, criterion, true, ["PZA", "PZB"]);
	const listed = async () =>
		(await execute(query, root)).results.map((r) => r.person.personId);
	const pending = async () =>
		(await probe(query, root)).unconfirmed.map((s) => s.experienceId);
	const before = await pending();
	assert.equal(before.length, 2);
	assert.deepEqual(await listed(), ["PZA", "PZB"]);
	const { scoreEvidence } = await import("#/server/scoring");
	await answeringScores(
		(segments) => ({
			scores: segments.map(({ n, text }) => ({
				n,
				score: text.includes("配载员B") ? 100 : 1,
			})),
		}),
		() => scoreEvidence(query, root, record),
	);
	assert.deepEqual(await listed(), ["PZB", "PZA"]);
	assert.deepEqual(await pending(), before);
});

describe("读经历", () => {
	test("两个条件在同一波捞到同一判据的相同段时只确认一次", async () => {
		const { call, seen, search } = await agent();
		const criterion = "本人做配载";
		const conditions = [
			seeking("配载岗位", ["配载员"], criterion),
			seeking("配载经历", [], criterion, {
				where: "e.title ilike :title",
				params: { title: "%配载员%" },
			}),
		];
		assert.equal((await call<Tried>("probe", { conditions })).unread, 2);
		await call<Read>("read", { conditions });
		assert.deepEqual(
			seen.map((b) => b.segments.length),
			[2],
		);
		assert.deepEqual(await saved(search, criterion), [true, true]);
	});

	test("读候选人没读过的经历：一批只读一条条件的，每段有编号，职级高的人在前；给的是在哪、序列、岗位、技能和原文，没有姓名、工号和起止时间；回来的是每条读了多少、多少算数", async () => {
		const { call, steps, seen, search } = await agent();
		const criterion = "本人做设备巡检";
		const done = await call<Read>("read", {
			conditions: [seeking("做过巡检", ["巡检"], criterion)],
		});
		assert.equal(seen.length, 1, "三段一批读完");
		const [batch] = seen;
		assert.ok(batch);
		assert.deepEqual([batch.label, batch.criterion], ["做过巡检", criterion]);
		const { segments } = batch;
		assert.deepEqual(
			segments.map((s) => [s.n, /岗位：(.*)/.exec(s.text)?.[1]]),
			[
				[1, "巡检员"],
				[2, "巡检组长"],
				[3, "巡检设备销售"],
			],
			"P7 的在 P5 的前面，没有职级的最后",
		);
		assert.equal(
			segments[1]?.text,
			[
				"公司内的任职，部门：制造中心/设备部",
				"序列：生产 · 设备",
				"岗位：巡检组长",
				"技能：主导 设备巡检",
				"简历原文：带一个班组做产线设备巡检",
			].join("\n"),
		);
		assert.equal(
			segments[0]?.text,
			[
				"外部的经历，公司：乙未机械",
				"岗位：巡检员",
				"简历原文：负责夜班巡检",
			].join("\n"),
		);
		assert.doesNotMatch(JSON.stringify(batch), /合成|XJ0|\d{4}-\d{2}/);
		assert.deepEqual(done.conditions, [
			{ label: "做过巡检", read: 3, fits: 3 },
		]);
		assert.equal(done.left, 0);
		assert.match(done.todo ?? "", /候选人的经历都读过了/);
		assert.doesNotMatch(
			JSON.stringify(done),
			/巡检员|乙未机械/,
			"经历的文字不回给查询理解",
		);
		assert.deepEqual(plain(steps), [
			{ tool: "read", segments: 3, left: 3 },
			{ tool: "judge", fits: 3, unfit: 0 },
		]);
		assert.deepEqual(await saved(search, criterion), [true, true, true]);
	});

	test("原文再长也给全：搜索捞得到的字，读的时候都看得到", async () => {
		const tail = "后期转去做钢轨探伤作业";
		await seed([
			{
				personId: "TS01",
				name: "合成探伤",
				segments: [
					{
						kind: "external",
						months: 24,
						company: "丁酉工务",
						title: "专员",
						description: `${"负责日常行政事务。".repeat(400)}${tail}`,
					},
				],
			},
		]);
		const { call, seen } = await agent();
		const done = await call<Read>("read", {
			conditions: [seeking("做过探伤", ["探伤"], "本人做探伤作业")],
		});
		assert.deepEqual(
			done.conditions?.map((c) => c.read),
			[1],
			"字面只在原文末尾对得上",
		);
		assert.ok(seen[0]?.segments[0]?.text.endsWith(tail));
	});

	test("设了字节上限时长短经历按完整输入大小分批，不截断、不漏读，批内编号和最终名单保持一致", async () => {
		const descriptions = [
			`甲${'中文\n"\\'.repeat(2000)}末尾符合`,
			`乙${'中文\n"\\'.repeat(2000)}末尾不符`,
			`丙${'中文\n"\\'.repeat(2000)}末尾符合`,
			`丁${"很长的登记原文".repeat(7000)}末尾符合`,
			"戊短经历末尾符合",
		];
		await seed(
			descriptions.map((description, i) => ({
				personId: `BUDGET${i}`,
				name: "合成分批",
				curLevel: i === 0 ? "P8" : "P5",
				segments: [{ months: 12, title: "合成输入分批", description }],
			})),
		);
		let active = 0;
		let peak = 0;
		const { call, steps, seen, search } = await agent(async (batch) => {
			peak = Math.max(peak, ++active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active--;
			return batch.segments
				.filter((s) => s.text.endsWith("末尾符合"))
				.map((s) => s.n);
		});
		const criterion = "本人符合这一项要求";
		const done = await call<Read>("read", {
			conditions: [seeking("合成分批", ["合成输入分批"], criterion)],
		});
		assert.equal(peak, 2);
		assert.equal(done.left, 0);
		assert.deepEqual(done.conditions, [
			{ label: "合成分批", read: 5, fits: 4 },
		]);
		assert.equal(
			seen[0]?.segments[0]?.text.endsWith(descriptions[0] as string),
			true,
		);
		for (const batch of seen) {
			assert.ok(
				batch.segments.length === 1 ||
					Buffer.byteLength(JSON.stringify(batch)) <= BATCH_BYTES,
			);
			assert.deepEqual(
				batch.segments.map((s) => s.n),
				batch.segments.map((_, i) => i + 1),
			);
		}
		assert.deepEqual(
			seen
				.flatMap((b) => b.segments.map((s) => s.text.split("简历原文：")[1]))
				.sort(),
			[...descriptions].sort(),
		);
		assert.deepEqual(await saved(search, criterion), [
			true,
			true,
			true,
			true,
			false,
		]);
		assert.equal(
			steps.reduce(
				(n, s) => n + (s.tool === "read" && "segments" in s ? s.segments : 0),
				0,
			),
			5,
		);
		const outcome = await execute(
			{ conditions: [judged("分批", ["合成输入分批"], criterion)] },
			search,
		);
		assert.deepEqual(outcome.results.map((r) => r.person.personId).sort(), [
			"BUDGET0",
			"BUDGET2",
			"BUDGET3",
			"BUDGET4",
		]);
	});

	test("排除的条件一样读、一样判：判成符合，这个人就不在名单上；没读之前他是候选，不上名单", async () => {
		const { call, seen, search } = await agent();
		const [done, sold] = ["本人做设备巡检", "本人做销售"];
		const conditions = [
			seeking("做过巡检", ["巡检"], done),
			seeking("做过销售", ["销售"], sold, { mode: "exclude" }),
		];
		const query = {
			conditions: [
				judged("巡检", ["巡检"], done),
				judged("销售", ["销售"], sold, { mode: "exclude" }),
			],
		};
		const listed = async () => {
			const outcome = await execute(query, search);
			return [
				outcome.results.map((r) => r.person.personId).sort(),
				outcome.incomplete,
			];
		};
		assert.deepEqual(await listed(), [[], { above: null }]);
		const read = await call<Read>("read", { conditions });
		assert.deepEqual(
			seen.map((batch) => [batch.label, batch.segments.length]),
			[
				["做过巡检", 3],
				["做过销售", 1],
			],
			"两条条件各读各的一批；XJ03 的岗位里有「销售」",
		);
		assert.equal(read.left, 0);
		assert.deepEqual(await listed(), [["XJ01", "XJ02"], undefined]);
	});

	test("交回的编号存成算，这一批里别的段存成不算；同一份条件再试跑是新的数", async () => {
		const { call, steps, search } = await agent(
			fitsWhere((text) => text.includes("巡检组长")),
		);
		const criterion = "本人做设备巡检；卖巡检设备的不算";
		const conditions = [seeking("做过巡检", ["巡检"], criterion)];
		const before = await call<Tried>("probe", { conditions });
		assert.equal(before.conditions[0]?.people, 3, "字面对得上的人");
		assert.equal(before.total, 0, "一段都没读过，名单上没有人");
		assert.equal(before.candidates, 3);
		assert.equal(before.unread, 3);

		const done = await call<Read>("read", { conditions });
		assert.deepEqual(done.conditions, [
			{ label: "做过巡检", read: 3, fits: 1 },
		]);
		assert.deepEqual(await saved(search, criterion), [true, false, false]);

		const after = await call<Tried>("probe", { conditions });
		assert.equal(after.conditions[0]?.people, 1, "判成不算的段不再是候选");
		assert.deepEqual([after.total, after.candidates, after.unread], [1, 1, 0]);

		const again = await call<Read>("read", { conditions });
		assert.deepEqual([again.conditions, again.left], [[], 0]);
		assert.deepEqual(
			plain(steps).map((step) => (step.tool === "probe" ? step.tool : step)),
			[
				"probe",
				{ tool: "read", segments: 3, left: 3 },
				{ tool: "judge", fits: 1, unfit: 2 },
				"probe",
				{ tool: "read", segments: 0, left: 0 },
			],
			"都读过了再去读，记一步没有可读的",
		);
	});

	test("读过的段不用再读：同一条判据下已有结论的不再给", async () => {
		const { call, seen, search } = await agent();
		const criterion = "本人做设备巡检";
		await conclude(search, criterion, true, ["XJ01"]);
		const done = await call<Read>("read", {
			conditions: [seeking("做过巡检", ["巡检"], criterion)],
		});
		assert.deepEqual(
			done.conditions?.map((c) => c.read),
			[2],
		);
		assert.ok(seen[0]?.segments.every((s) => !s.text.includes("巡检组长")));
	});

	test("一批读不完的分成几批同时读：每一批自己从 1 编号，各交各的结论", async () => {
		let reading = 0;
		let together = 0;
		const { call, steps, seen, search } = await agent(async (batch) => {
			together = Math.max(together, ++reading);
			// 让出一拍：别的批这时已经发出去了
			await new Promise((resolve) => setTimeout(resolve, 5));
			reading--;
			return batch.segments.map((s) => s.n);
		});
		const criterion = "本人做叉车调度";
		const done = await call<Read>("read", {
			conditions: [seeking("做过叉车调度", ["叉车"], criterion)],
		});
		assert.equal(together, 2, "两批同时在读");
		assert.deepEqual(
			seen.map((batch) => batch.segments.map((s) => s.n)),
			[
				Array.from({ length: READ_BATCH }, (_, i) => i + 1),
				Array.from({ length: MANY - READ_BATCH }, (_, i) => i + 1),
			],
		);
		assert.deepEqual(done.conditions, [
			{ label: "做过叉车调度", read: MANY, fits: MANY },
		]);
		assert.equal(done.left, 0);
		assert.deepEqual(plain(steps)[0], {
			tool: "read",
			segments: MANY,
			left: MANY,
		});
		assert.deepEqual(
			plain(steps)
				.slice(1)
				.map((step) => step.tool === "judge" && "fits" in step && step.fits)
				.sort(),
			[MANY - READ_BATCH, READ_BATCH].sort(),
		);
		assert.equal((await saved(search, criterion)).length, MANY);
	});

	test("读完一波重新取当前候选：已经确定不满足必须条件的人，其余经历不再占读取额度", async () => {
		// 模具设计两批才读得完的一个人：一段铸件检测，其余是模具设计
		const MOULDS = READ_BATCH * 2;
		await seed([
			{
				personId: "CAST_HIGH",
				name: "合成铸件甲",
				curLevel: "P8",
				segments: [
					{ months: 12, title: "铸件检测高档" },
					...Array.from({ length: MOULDS }, (_, i) => ({
						months: 12,
						title: `模具设计高档${i}`,
					})),
				],
			},
			{
				personId: "CAST_LOW",
				name: "合成铸件乙",
				curLevel: "P5",
				segments: [
					{ months: 12, title: "铸件检测低档" },
					{ months: 12, title: "模具设计低档" },
				],
			},
		]);
		const { call, seen, search } = await agent(
			fitsWhere((text) => !text.includes("岗位：铸件检测高档")),
		);
		const conditions = [
			seeking("做过铸件检测", ["铸件检测"], "本人做铸件检测"),
			seeking("做过模具设计", ["模具设计"], "本人做模具设计"),
		];
		const done = await call<Read>("read", { conditions });
		assert.equal(done.left, 0);
		const texts = seen.flatMap((batch) => batch.segments.map((s) => s.text));
		assert.equal(
			texts.filter((text) => text.includes("模具设计高档")).length,
			READ_BATCH,
			"甲的模具设计只读了第一波里的那一批，判出局之后剩下的没有再读",
		);
		assert.equal(texts.length, READ_BATCH + 3);
		const query = {
			conditions: [
				judged("铸件检测", ["铸件检测"], "本人做铸件检测"),
				judged("模具设计", ["模具设计"], "本人做模具设计"),
			],
		};
		assert.deepEqual(
			(await execute(query, search)).results.map((r) => r.person.personId),
			["CAST_LOW"],
		);
	});

	test("候选多到一轮读不完：从职级高的人读起，读到上限为止，可以提交；名单写明列到哪一档；条件不变再来一轮接着往下读", async () => {
		const { call, steps, seen, search } = await agent();
		const criterion = "本人做装配";
		const conditions = [seeking("做过装配", ["装配"], criterion)];
		const done = await call<Read>("read", { conditions });
		assert.deepEqual(
			seen[0]?.segments.map((s) => s.text.includes("装配班长")),
			Array.from({ length: READ_BATCH }, (_, i) => i < LEADS),
			"职级高的那几位在最前面",
		);
		assert.deepEqual(done.conditions, [
			{ label: "做过装配", read: READ_MAX, fits: READ_MAX },
		]);
		assert.equal(done.left, TOO_MANY - READ_MAX);
		assert.match(done.todo ?? "", /这一轮能读的经历到上限了.*不用为此改条件/);
		assert.equal(seen.length, READ_MAX / READ_BATCH);
		assert.equal((await saved(search, criterion)).length, READ_MAX);

		const again = await call<Read>("read", { conditions });
		assert.deepEqual(again.conditions, [], "到了上限不再读");
		assert.equal(again.left, TOO_MANY - READ_MAX);
		assert.match(again.todo ?? "", /到上限了/, "不说成都读过了");
		assert.deepEqual(plain(steps).at(-1), {
			tool: "read",
			segments: 0,
			left: TOO_MANY - READ_MAX,
		});
		const tried = await call<Tried>("probe", { conditions });
		assert.deepEqual(
			[tried.total, tried.candidates, tried.unread],
			[READ_MAX, TOO_MANY, TOO_MANY - READ_MAX],
		);
		assert.match(tried.todo, /到上限了/);
		// 到了上限照常提交，加上一条还没读过的加分条件也收
		const boost = seeking("带过班组", ["装配班长"], "带过装配班组", {
			mode: "boost",
		});
		assert.deepEqual(await call("submit", table([...conditions, boost])), {
			passed: true,
		});

		const outcome = await execute(
			{ conditions: [judged("做过装配", ["装配"], criterion)] },
			search,
		);
		assert.equal(outcome.total, READ_MAX);
		assert.deepEqual(
			outcome.incomplete,
			{ above: "P8" },
			"没确认的都是 P5 的人，P8 这一档确认完了",
		);

		// 条件不变再来一轮：读过的不重读，从没读到的接着读，读完名单就完整了
		const resumed = await agentOn(search);
		const rest = await resumed.call<Read>("read", { conditions });
		assert.deepEqual(rest.conditions, [
			{
				label: "做过装配",
				read: TOO_MANY - READ_MAX,
				fits: TOO_MANY - READ_MAX,
			},
		]);
		assert.equal(rest.left, 0);
		assert.equal((await saved(search, criterion)).length, TOO_MANY);
		const whole = await execute(
			{ conditions: [judged("做过装配", ["装配"], criterion)] },
			search,
		);
		assert.equal(whole.total, TOO_MANY);
		assert.equal(whole.incomplete, undefined);
	});

	test("同一轮同时调用两次读经历，共用候选、并发和额度，不重复确认", async () => {
		let active = 0;
		let peak = 0;
		const { call, seen } = await agent(async (batch) => {
			peak = Math.max(peak, ++active);
			await new Promise((resolve) => setTimeout(resolve, 20));
			active--;
			return batch.segments.map((s) => s.n);
		});
		const input = {
			conditions: [seeking("叉车调度", ["叉车"], "本人做叉车调度")],
		};
		const results = await Promise.all([
			call<Read>("read", input),
			call<Read>("read", input),
		]);
		assert.equal(peak, 2);
		assert.equal(
			seen.reduce((n, b) => n + b.segments.length, 0),
			MANY,
		);
		assert.equal(
			results
				.flatMap((r) => {
					assert.ok(r.conditions);
					return r.conditions;
				})
				.reduce((n, c) => n + c.read, 0),
			MANY,
		);
	});

	test("有一批没读成：等其余批收尾，已保存的结论计入额度并刷新试跑", async () => {
		const { call, search } = await agent(async (batch) => {
			if (batch.segments.length < READ_BATCH) throw new Error("端点坏了");
			await new Promise((resolve) => setTimeout(resolve, 50));
			return batch.segments.map((s) => s.n);
		});
		const criterion = "本人做叉车调度";
		const input = {
			conditions: [seeking("做过叉车调度", ["叉车"], criterion)],
		};
		assert.equal((await call<Tried>("probe", input)).unread, MANY);
		await assert.rejects(call("read", input), /端点坏了/);
		assert.equal((await saved(search, criterion)).length, READ_BATCH);
		assert.equal((await call<Tried>("probe", input)).unread, MANY - READ_BATCH);
		const rest = await call<Read>("read", {
			conditions: [seeking("做过装配", ["装配"], "本人做装配")],
		});
		assert.deepEqual(rest.conditions, [
			{
				label: "做过装配",
				read: READ_MAX - READ_BATCH,
				fits: READ_MAX - READ_BATCH,
			},
		]);
		assert.equal(rest.left, TOO_MANY - (READ_MAX - READ_BATCH));
	});
});

describe("读经历和提交", () => {
	test("没读的经历不挡提交：读是模型看自己写得准不准的办法，没读完的这一轮最后接着读", async () => {
		const { call, steps, passed } = await agent();
		const submitted = table([seeking("做过巡检", ["巡检"], "本人做设备巡检")]);
		assert.deepEqual(await call("submit", submitted), { passed: true });
		assert.equal(passed(), true);
		assert.deepEqual(steps, [], "通过的提交不记步骤，也没有替模型读");
	});

	test("读过之后改了判据的字：照收；新判据下的段按没读过算，读过的结论还在旧判据名下", async () => {
		const { call } = await agent();
		const criterion = "本人做设备巡检";
		await call("read", {
			conditions: [seeking("做过巡检", ["巡检"], criterion)],
		});
		const reworded = [
			seeking("做过巡检", ["巡检"], `${criterion}，带过班组的更好`),
		];
		const tried = await call<Tried>("probe", { conditions: reworded });
		assert.equal(tried.unread, 3, "按新判据的字，三段都还没读");
		assert.deepEqual(await call("submit", table(reworded)), {
			passed: true,
		});
	});

	test("加分条件上的经历也要读完：必须的先读，读完才轮到加分的，判成不算的人加分的段不用读", async () => {
		const { call, seen } = await agent(
			fitsWhere((text) => !text.includes("销售")),
		);
		const must = seeking("做过巡检", ["巡检"], "本人做设备巡检");
		const boost = seeking("带过班组", ["巡检"], "带过班组的优先", {
			mode: "boost",
		});
		const done = await call<Read>("read", { conditions: [must, boost] });
		assert.deepEqual(
			seen.map((batch) => [batch.label, batch.segments.length]),
			[
				["做过巡检", 3],
				["带过班组", 2],
			],
		);
		assert.equal(done.left, 0);
		assert.deepEqual(await call("submit", table([must, boost])), {
			passed: true,
		});
	});

	test("找不到人看的是字面对不对得上：读完都不算，才是一个人都找不到，原样再交就收", async () => {
		const { call, steps, search } = await agent();
		const criterion = "本人做设备巡检";
		await conclude(search, criterion, false, ["XJ01", "XJ02", "XJ03"]);
		const submitted = table([seeking("做过巡检", ["巡检"], criterion)]);
		const refused = await call<Checked>("submit", submitted);
		assert.match(refused.problems?.join() ?? "", /做过巡检.*一个人都找不到/);
		assert.deepEqual(
			steps.map((step) => step.tool === "submit" && step.issues),
			[[{ kind: "unfound", subject: "做过巡检" }]],
		);
		assert.deepEqual(await call("submit", submitted), { passed: true });
	});
});
