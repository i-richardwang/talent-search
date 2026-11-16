/**
 * 读经历（`server/reading.ts`，经查询理解的 `read` 工具），和提交前「候选人的经历读完没有」的
 * 检查。跑在临时 schema 上的真 SQL，不经过模型：直接按工具的入参调，每一批算不算由用例自己给。
 * 数据全是合成的。每个用例是一次自己的找人任务：结论记在它名下，也只认它名下的。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { TraceStep } from "#/search/trace";
import type { Group, Judge } from "#/server/reading";
import {
	agentOn,
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

const teardown = await setup();
after(teardown);

const { READ_BATCH, READ_MAX, READ_WAVE } = await import("#/server/reading");
const { criterionKey } = await import("#/search/verdict");
const { execute } = await import("#/search/execute");
const { pool } = await import("#/db");

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
			empId: "XJ01",
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
			empId: "XJ02",
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
			empId: "XJ03",
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
		...numbered("CC", MANY).map((empId) => ({
			empId,
			name: `合成${empId}`,
			segments: [{ months: 24, title: "叉车调度" }],
		})),
		...numbered("ZP", TOO_MANY).map((empId, i) => ({
			empId,
			name: `合成${empId}`,
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

const segmentsOf = (batch: readonly Group[]) =>
	batch.flatMap((group) => group.segments);
/** 这次找人任务里一条判据下存了哪些结论。 */
async function saved(search: string, criterion: string) {
	const { rows } = await pool.query<{ fits: boolean }>(
		"select fits from experience_verdict where root_turn_id = $1 and criterion_key = $2 order by fits desc",
		[search, criterionKey(criterion)],
	);
	return rows.map((row) => row.fits);
}
const plain = (steps: TraceStep[]) => steps.map(({ at: _at, ...step }) => step);

describe("读经历", () => {
	test("读候选人没读过的经历：按条件分组，每段有编号，职级高的人在前；给的是在哪、序列、岗位、技能和原文，没有姓名、工号和起止时间；回来的是每条读了多少、多少算数", async () => {
		const { call, steps, seen, search } = await agent();
		const criterion = "本人做设备巡检";
		const done = await call<Read>("read", {
			conditions: [seeking("做过巡检", ["巡检"], criterion)],
		});
		assert.equal(seen.length, 1, "三段一批读完");
		const [batch] = seen;
		assert.ok(batch);
		assert.deepEqual(
			batch.map((g) => [g.label, g.criterion]),
			[["做过巡检", criterion]],
		);
		const segments = segmentsOf(batch);
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
				"入职前的经历，公司：乙未机械",
				"岗位：巡检员",
				"简历原文：负责夜班巡检",
			].join("\n"),
		);
		assert.doesNotMatch(JSON.stringify(batch), /合成|XJ0|\d{4}-\d{2}/);
		assert.deepEqual(done.conditions, [
			{ label: "做过巡检", read: 3, fits: 3 },
		]);
		assert.equal(done.left, 0);
		assert.match(done.todo ?? "", /都读过了，可以提交/);
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
				empId: "TS01",
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
		assert.ok(segmentsOf(seen[0] ?? [])[0]?.text.endsWith(tail));
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
				outcome.results.map((r) => r.employee.empId).sort(),
				outcome.incomplete,
			];
		};
		assert.deepEqual(await listed(), [[], { above: null }]);
		const read = await call<Read>("read", { conditions });
		assert.deepEqual(
			seen[0]?.map((g) => [g.label, g.segments.length]),
			[
				["做过巡检", 3],
				["做过销售", 1],
			],
			"XJ03 的岗位里有「销售」",
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
		assert.ok(
			segmentsOf(seen[0] ?? []).every((s) => !s.text.includes("巡检组长")),
		);
	});

	test("一批读不完的分成几批同时读：每一批自己从 1 编号，各交各的结论", async () => {
		let reading = 0;
		let together = 0;
		const { call, steps, seen, search } = await agent(async (groups) => {
			together = Math.max(together, ++reading);
			// 让出一拍：别的批这时已经发出去了
			await new Promise((resolve) => setTimeout(resolve, 5));
			reading--;
			return seen.length > 0 && groups === seen[0]
				? []
				: segmentsOf(groups).map((s) => s.n);
		});
		const criterion = "本人做叉车调度";
		const done = await call<Read>("read", {
			conditions: [seeking("做过叉车调度", ["叉车"], criterion)],
		});
		assert.equal(together, 2, "两批同时在读");
		assert.deepEqual(
			seen.map((batch) => segmentsOf(batch).map((s) => s.n)),
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
		// 一波读不完的一个人：一段铸件检测，其余是模具设计
		const WAVE = READ_WAVE;
		await seed([
			{
				empId: "CAST_HIGH",
				name: "合成铸件甲",
				curLevel: "P8",
				segments: [
					{ months: 12, title: "铸件检测高档" },
					...Array.from({ length: WAVE }, (_, i) => ({
						months: 12,
						title: `模具设计高档${i}`,
					})),
				],
			},
			{
				empId: "CAST_LOW",
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
		const texts = seen.flatMap((batch) => segmentsOf(batch).map((s) => s.text));
		assert.equal(texts.length, WAVE + 2, "甲剩下的那一段没有再读");
		assert.ok(texts.slice(WAVE).every((text) => text.includes("低档")));
		const query = {
			conditions: [
				judged("铸件检测", ["铸件检测"], "本人做铸件检测"),
				judged("模具设计", ["模具设计"], "本人做模具设计"),
			],
		};
		assert.deepEqual(
			(await execute(query, search)).results.map((r) => r.employee.empId),
			["CAST_LOW"],
		);
	});

	test("候选多到一轮读不完：从职级高的人读起，读到上限为止，可以提交；名单写明列到哪一档；条件不变再来一轮接着往下读", async () => {
		const { call, steps, seen, search } = await agent();
		const criterion = "本人做装配";
		const conditions = [seeking("做过装配", ["装配"], criterion)];
		const done = await call<Read>("read", { conditions });
		assert.deepEqual(
			segmentsOf(seen[0] ?? []).map((s) => s.text.includes("装配班长")),
			Array.from({ length: READ_BATCH }, (_, i) => i < LEADS),
			"职级高的那几位在最前面",
		);
		assert.deepEqual(done.conditions, [
			{ label: "做过装配", read: READ_MAX, fits: READ_MAX },
		]);
		assert.equal(done.left, TOO_MANY - READ_MAX);
		assert.match(done.todo ?? "", /这一轮能读的经历读完了.*直接提交/);
		assert.equal(seen.length, READ_MAX / READ_BATCH);
		assert.equal((await saved(search, criterion)).length, READ_MAX);

		const again = await call<Read>("read", { conditions });
		assert.deepEqual(again.conditions, [], "到了上限不再读");
		assert.equal(again.left, TOO_MANY - READ_MAX);
		assert.match(again.todo ?? "", /直接提交/, "不说成都读过了");
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
		assert.match(tried.todo, /直接提交/);
		// 必须的没读完，轮不到加分的：它的判据这一轮没读过，不算读过之后改了字
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

	test("有一批没读成：这一次读经历失败，别的批交上来的结论照存", async () => {
		const { call, search } = await agent(async (groups) => {
			if (segmentsOf(groups).length < READ_BATCH) throw new Error("端点坏了");
			return segmentsOf(groups).map((s) => s.n);
		});
		const criterion = "本人做叉车调度";
		await assert.rejects(
			call("read", {
				conditions: [seeking("做过叉车调度", ["叉车"], criterion)],
			}),
			/端点坏了/,
		);
		// 读成的那一批在失败之后才写完也算数：等它落库
		await new Promise((resolve) => setTimeout(resolve, 200));
		assert.equal((await saved(search, criterion)).length, READ_BATCH);
	});
});

describe("提交前候选人的经历要读完", () => {
	test("还有读得完的经历没读：不通过，原样再交也不收；读完再交就通过", async () => {
		const { call, steps, passed, answer } = await agent();
		const criterion = "本人做设备巡检";
		const conditions = [seeking("做过巡检", ["巡检"], criterion)];
		for (const _ of [1, 2]) {
			const refused = await call<Checked>("submit", table(conditions));
			assert.equal(refused.passed, false);
			assert.equal(refused.problems?.length, 1);
			assert.match(
				refused.problems?.[0] ?? "",
				/候选人还有经历没读过，没读过的不上名单.*read/,
			);
			assert.equal(passed(), false);
		}
		assert.deepEqual(
			plain(steps),
			Array.from({ length: 2 }, () => ({
				tool: "submit",
				issues: [{ kind: "unread", subject: null }],
			})),
		);
		assert.deepEqual(
			answer()?.admitted.query.conditions.map((c) => c.label),
			["做过巡检"],
			"条件本身跑得通，录取的那份里有它",
		);

		await call("read", { conditions });
		assert.deepEqual(await call("submit", table(conditions)), {
			passed: true,
		});
		assert.equal(passed(), true);
	});

	test("读过之后改了判据的文字：读过的结论用不上，不收，原样再交也不收；改回读的时候那一份就通过", async () => {
		const { call, steps } = await agent();
		const criterion = "本人做设备巡检";
		const conditions = [seeking("做过巡检", ["巡检"], criterion)];
		await call("read", { conditions });
		const rewritten = table([
			seeking("做过巡检", ["巡检"], `${criterion}，带过班组的更好`),
		]);
		for (const _ of [1, 2]) {
			const refused = await call<Checked>("submit", rewritten);
			assert.equal(refused.passed, false);
			assert.equal(refused.problems?.length, 1);
			assert.match(
				refused.problems?.[0] ?? "",
				/「做过巡检」的 criterion 和读经历时用的不一样/,
			);
		}
		assert.deepEqual(plain(steps).slice(-1), [
			{ tool: "submit", issues: [{ kind: "unread", subject: "做过巡检" }] },
		]);
		assert.deepEqual(await call("submit", table(conditions)), {
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
			seen.map((batch) => batch.map((g) => [g.label, g.segments.length])),
			[[["做过巡检", 3]], [["带过班组", 2]]],
		);
		assert.equal(done.left, 0);
		assert.deepEqual(await call("submit", table([must, boost])), {
			passed: true,
		});
	});

	test("问了问题不能代替读：读得完的经历没读，问了也不收", async () => {
		const { call } = await agent();
		const refused = await call<Checked>(
			"submit",
			table([seeking("做过巡检", ["巡检"], "本人做设备巡检")], {
				says: "想找哪一类巡检？",
				current: "先不分",
				options: [{ label: "只看设备巡检", detail: "" }],
			}),
		);
		assert.equal(refused.passed, false);
		assert.match(refused.problems?.join() ?? "", /候选人还有经历没读过/);
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
