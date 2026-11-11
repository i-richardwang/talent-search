/**
 * 查询理解读经历、下结论（`server/agent-tools.ts` 的 `read` 与 `judge`），和提交前「候选人的
 * 经历看完没有」的检查。跑在临时 schema 上的真 SQL，不经过模型：直接按工具的入参调，结论由
 * 用例自己给。数据全是合成的。每个用例是一次自己的找人任务：结论记在它名下，也只认它名下的。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { TraceStep } from "#/search/trace";
import {
	agentOn,
	type Batch,
	type Checked,
	conclude,
	judged,
	openSearch,
	seed,
	setup,
	type Tried,
	table,
} from "./fixture";

const teardown = await setup();
after(teardown);

const { READ_BATCH, READ_MAX } = await import("#/server/agent-tools");
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

/** 开一次找人任务，连同在它里面调的一套工具。 */
async function agent() {
	const search = await openSearch();
	return { ...(await agentOn(search)), search };
}

const segmentsOf = (batch: Batch) =>
	(batch.groups ?? []).flatMap((group) => group.segments);
/** 这一批每一段都符合。 */
const all = (batch: Batch) => ({ fits: segmentsOf(batch).map(({ n }) => n) });
/** 这一批没有一段符合。 */
const none = { fits: [] };
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
	test("取候选人没看过的经历：按条件分组，每段有编号，职级高的人在前；给的是在哪、序列、岗位、技能和原文，没有姓名、工号和起止时间", async () => {
		const { call, steps, search } = await agent();
		const criterion = "本人做设备巡检";
		const batch = await call<Batch>("read", {
			conditions: [seeking("做过巡检", ["巡检"], criterion)],
		});
		assert.equal(batch.left, 3);
		assert.equal(batch.groups?.length, 1);
		assert.equal(batch.groups?.[0]?.label, "做过巡检");
		assert.equal(batch.groups?.[0]?.criterion, criterion);
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
		assert.match(batch.todo ?? "", /judge/);
		assert.deepEqual(plain(steps), [{ tool: "read", segments: 3, left: 3 }]);
		assert.deepEqual(await saved(search, criterion), [], "只是读，还没有结论");
	});

	test("原文再长也给全：搜索捞得到的字，模型都读得到", async () => {
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
		const { call } = await agent();
		const batch = await call<Batch>("read", {
			conditions: [seeking("做过探伤", ["探伤"], "本人做探伤作业")],
		});
		const [segment] = segmentsOf(batch);
		assert.equal(batch.left, 1, "字面只在原文末尾对得上");
		assert.ok(segment?.text.endsWith(tail));
	});

	test("排除的条件一样读、一样判：判成符合，这个人就不在名单上；没读之前他是候选，不上名单", async () => {
		const { call, search } = await agent();
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
		const batch = await call<Batch>("read", { conditions });
		assert.deepEqual(
			batch.groups?.map((g) => [g.label, g.segments.length]),
			[
				["做过巡检", 3],
				["做过销售", 1],
			],
			"XJ03 的岗位里有「销售」",
		);
		assert.deepEqual(await listed(), [[], { above: null }]);
		const after = await call<Batch>("judge", all(batch));
		assert.equal(after.left, 0);
		assert.deepEqual(await listed(), [["XJ01", "XJ02"], undefined]);
	});

	test("交结论只交符合的编号：交了的存成算，这一批里没交的存成不算；编号不在这一批里的整次不收；同一份条件再试跑是新的数", async () => {
		const { call, steps, search } = await agent();
		const criterion = "本人做设备巡检；卖巡检设备的不算";
		const conditions = [seeking("做过巡检", ["巡检"], criterion)];
		const before = await call<Tried>("probe", { conditions });
		assert.equal(before.conditions[0]?.people, 3, "字面对得上的人");
		assert.equal(before.total, 0, "一段都没看过，名单上没有人");
		assert.equal(before.candidates, 3);
		assert.equal(before.unread, 3);

		const batch = await call<Batch>("read", { conditions });
		const lead = segmentsOf(batch).find((s) => s.text.includes("巡检组长"));
		const stray = await call<Batch>("judge", { fits: [lead?.n, 99] });
		assert.match(stray.problem ?? "", /编号 99 不在这一批里/);
		assert.deepEqual(
			segmentsOf(stray),
			segmentsOf(batch),
			"这一批原样再给一次",
		);
		assert.deepEqual(await saved(search, criterion), [], "什么都没存");
		const done = await call<Batch>("judge", { fits: [lead?.n] });
		assert.equal(done.saved, 3);
		assert.equal(done.left, 0);
		assert.equal(done.groups, undefined);
		assert.match(done.todo ?? "", /都看过了，可以提交/);
		assert.deepEqual(await saved(search, criterion), [true, false, false]);

		const after = await call<Tried>("probe", { conditions });
		assert.equal(after.conditions[0]?.people, 1, "判成不算的段不再是候选");
		assert.deepEqual([after.total, after.candidates, after.unread], [1, 1, 0]);
		assert.deepEqual(
			plain(steps).map((step) => (step.tool === "probe" ? step.tool : step)),
			[
				"probe",
				{ tool: "read", segments: 3, left: 3 },
				{ tool: "judge", redo: true },
				{ tool: "judge", fits: 1, unfit: 2 },
				"probe",
			],
			"看完了不再记一步空的读",
		);
	});

	test("别的理解看过的段不用再看：同一条判据下已有结论的不再给", async () => {
		const { call, search } = await agent();
		const criterion = "本人做设备巡检";
		await conclude(search, criterion, true, ["XJ01"]);
		const batch = await call<Batch>("read", {
			conditions: [seeking("做过巡检", ["巡检"], criterion)],
		});
		assert.equal(batch.left, 2);
		assert.ok(segmentsOf(batch).every((s) => !s.text.includes("巡检组长")));
	});

	test("只收眼前这一批的结论：还没读就交、读完去做了别的再交，什么都不存，告诉模型先去读", async () => {
		const { call, steps, search } = await agent();
		const criterion = "本人做设备巡检";
		const conditions = [seeking("做过巡检", ["巡检"], criterion)];
		const early = await call<Batch>("judge", { fits: [1] });
		assert.equal(early.saved, undefined);
		assert.match(early.todo ?? "", /先用 read/);
		assert.deepEqual(plain(steps), [{ tool: "judge", redo: true }]);

		// 读完先去试跑：那一批已经不在模型眼前，空着交会把没看的段都存成不算
		await call<Batch>("read", { conditions });
		await call("probe", { conditions });
		const late = await call<Batch>("judge", none);
		assert.match(late.todo ?? "", /先用 read/);
		assert.deepEqual(await saved(search, criterion), [], "没看的段没有结论");

		await call("judge", all(await call<Batch>("read", { conditions })));
		const again = await call<Batch>("judge", none);
		assert.match(again.todo ?? "", /先用 read/);
		assert.deepEqual(
			await saved(search, criterion),
			[true, true, true],
			"交过的不改",
		);
	});

	test("一次一批：一批读不完的分几次给，编号接着往下数，交完一批带回下一批", async () => {
		const { call, steps, search } = await agent();
		const criterion = "本人做叉车调度";
		const first = await call<Batch>("read", {
			conditions: [seeking("做过叉车调度", ["叉车"], criterion)],
		});
		assert.equal(first.left, MANY);
		assert.deepEqual(
			segmentsOf(first).map((s) => s.n),
			Array.from({ length: READ_BATCH }, (_, i) => i + 1),
		);
		const second = await call<Batch>("judge", all(first));
		assert.equal(second.saved, READ_BATCH);
		assert.equal(second.left, MANY - READ_BATCH);
		assert.deepEqual(
			segmentsOf(second).map((s) => s.n),
			Array.from({ length: MANY - READ_BATCH }, (_, i) => READ_BATCH + i + 1),
		);
		const done = await call<Batch>("judge", none);
		assert.equal(done.left, 0);
		assert.deepEqual(plain(steps), [
			{ tool: "read", segments: READ_BATCH, left: MANY },
			{ tool: "judge", fits: READ_BATCH, unfit: 0 },
			{ tool: "read", segments: MANY - READ_BATCH, left: MANY - READ_BATCH },
			{ tool: "judge", fits: 0, unfit: MANY - READ_BATCH },
		]);
		assert.equal((await saved(search, criterion)).length, MANY);
	});

	test("交完一批后只读当前候选：已经确定不满足必须条件的人，其余经历不再占读取额度", async () => {
		await seed([
			{
				empId: "CAST_HIGH",
				name: "合成铸件甲",
				curLevel: "P8",
				segments: [
					{ months: 12, title: "铸件检测高档" },
					...Array.from({ length: READ_BATCH }, (_, i) => ({
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
		const { call, search } = await agent();
		const conditions = [
			seeking("做过铸件检测", ["铸件检测"], "本人做铸件检测"),
			seeking("做过模具设计", ["模具设计"], "本人做模具设计"),
		];
		const first = await call<Batch>("read", { conditions });
		assert.equal(segmentsOf(first).length, READ_BATCH);
		const next = await call<Batch>("judge", {
			fits: segmentsOf(first)
				.filter(({ text }) => !text.includes("岗位：铸件检测高档"))
				.map(({ n }) => n),
		});
		assert.equal(next.left, 2);
		assert.equal(segmentsOf(next).length, 2);
		assert.ok(segmentsOf(next).every(({ text }) => text.includes("低档")));
		await call("judge", all(next));
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

	test("候选多到一轮看不完：从职级高的人读起，读到上限为止，之后不再给内容，可以提交；名单写明覆盖到哪一档", async () => {
		const { call, steps, search } = await agent();
		const criterion = "本人做装配";
		const conditions = [seeking("做过装配", ["装配"], criterion)];
		let batch = await call<Batch>("read", { conditions });
		assert.equal(batch.left, TOO_MANY);
		assert.deepEqual(
			segmentsOf(batch).map((s) => s.text.includes("装配班长")),
			Array.from({ length: READ_BATCH }, (_, i) => i < LEADS),
			"职级高的那几位在最前面",
		);
		while (batch.groups) batch = await call<Batch>("judge", all(batch));
		assert.equal(batch.left, TOO_MANY - READ_MAX);
		assert.match(batch.todo ?? "", /这一轮能看的经历看完了.*直接提交/);
		assert.equal(
			steps.filter((step) => step.tool === "read").length,
			READ_MAX / READ_BATCH,
		);
		assert.equal((await saved(search, criterion)).length, READ_MAX);

		const again = await call<Batch>("read", { conditions });
		assert.equal(again.groups, undefined, "到了上限不再给内容");
		assert.equal(again.left, TOO_MANY - READ_MAX);
		assert.match(again.todo ?? "", /直接提交/, "不说成都看过了");
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
	});
});

describe("提交前候选人的经历要看完", () => {
	test("还有读得完的经历没看：不通过，原样再交也不收；看完再交就通过", async () => {
		const { call, steps, passed, answer } = await agent();
		const criterion = "本人做设备巡检";
		const conditions = [seeking("做过巡检", ["巡检"], criterion)];
		for (const _ of [1, 2]) {
			const refused = await call<Checked>("submit", table(conditions));
			assert.equal(refused.passed, false);
			assert.equal(refused.problems?.length, 1);
			assert.match(
				refused.problems?.[0] ?? "",
				/候选人还有经历没看过，没看过的不上名单.*read/,
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

		const batch = await call<Batch>("read", { conditions });
		await call("judge", all(batch));
		assert.deepEqual(await call("submit", table(conditions)), {
			passed: true,
		});
		assert.equal(passed(), true);
	});

	test("读过之后改了判据的文字：读过的结论用不上，不收，原样再交也不收；改回读的时候那一份就通过", async () => {
		const { call, steps } = await agent();
		const criterion = "本人做设备巡检";
		const conditions = [seeking("做过巡检", ["巡检"], criterion)];
		await call("judge", all(await call<Batch>("read", { conditions })));
		const rewritten = table([
			seeking("做过巡检", ["巡检"], `${criterion}，带过班组的更好`),
		]);
		for (const _ of [1, 2]) {
			const refused = await call<Checked>("submit", rewritten);
			assert.equal(refused.passed, false);
			assert.equal(refused.problems?.length, 1);
			assert.match(
				refused.problems?.[0] ?? "",
				/「做过巡检」的 criterion 和你读经历时写的不一样/,
			);
		}
		assert.deepEqual(plain(steps).slice(-1), [
			{ tool: "submit", issues: [{ kind: "unread", subject: "做过巡检" }] },
		]);
		assert.deepEqual(await call("submit", table(conditions)), {
			passed: true,
		});
	});

	test("加分条件上的经历也要看完", async () => {
		const { call } = await agent();
		const must = seeking("做过巡检", ["巡检"], "本人做设备巡检");
		const boost = seeking("带过班组", ["巡检"], "带过班组的优先", {
			mode: "boost",
		});
		const first = await call<Batch>("read", { conditions: [must, boost] });
		assert.deepEqual(
			first.groups?.map((g) => g.label),
			["做过巡检"],
			"必须的条件先看",
		);
		const second = await call<Batch>("judge", {
			fits: segmentsOf(first)
				.filter(({ text }) => !text.includes("销售"))
				.map(({ n }) => n),
		});
		assert.deepEqual(
			second.groups?.map((g) => [g.label, g.segments.length]),
			[["带过班组", 2]],
			"必须的条件判成不算的那个人，加分的段不用看",
		);
		const refused = await call<Checked>("submit", table([must, boost]));
		assert.match(refused.problems?.join() ?? "", /候选人还有经历没看过/);
		// 中间去提交了一次，手上那一批要重新取
		await call<Batch>("read", { conditions: [must, boost] });
		await call("judge", none);
		assert.deepEqual(await call("submit", table([must, boost])), {
			passed: true,
		});
	});

	test("问了问题不能代替读：读得完的经历没看，问了也不收", async () => {
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
		assert.match(refused.problems?.join() ?? "", /候选人还有经历没看过/);
	});

	test("找不到人看的是字面对不对得上：看完都不算，才是一个人都找不到，原样再交就收", async () => {
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
