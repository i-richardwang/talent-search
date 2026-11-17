/**
 * 发给查询理解模型的是人数、人才库里的写法和候选人经历的内容，没有人是谁：抓下一次完整理解
 * 发出的每一个请求体（假模型先把看目录、捞说法、试跑都用一遍，再把候选人的经历取来读、交上
 * 结论，工具的回答会跟着下一次请求发出去），里面不能有任何一个人的姓名或工号。数据全是合成的。
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { exploreAndCapture, OWNER, seed, seedStream, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { createTurn, loadThread, processTurn } = await import("#/server/turn");
const { db } = await import("#/db");
const { searchTurn } = await import("#/db/schema");
const { eq } = await import("drizzle-orm");

/** 认得出是谁的东西：一样都不该出现在请求体里。 */
const SECRETS = {
	names: ["龙骧甲", "龙骧乙", "龙骧丙"],
	empIds: ["ZQ7301", "ZQ7302", "ZQ7303"],
};

before(async () => {
	await seed(
		SECRETS.names.map((name, i) => ({
			empId: SECRETS.empIds[i] as string,
			name,
			education: "硕士",
			segments: [
				{
					kind: "external" as const,
					months: 36,
					company: "星河科技",
					title: "首席观星官",
					extracted: { skills: ["推荐系统"] },
				},
			],
		})),
	);
	await seedStream({
		stream: "perf",
		kind: "rating",
		label: "绩效",
		period: "半年",
		scale: ["C", "B", "A"],
		records: SECRETS.empIds.map((empId) => ({
			empId,
			periodStart: "2025-01-01",
			periodEnd: "2025-06-30",
			value: "A",
		})),
	});
	await seedStream({
		stream: "hipo",
		kind: "status",
		label: "高潜",
		records: SECRETS.empIds.map((empId) => ({
			empId,
			periodStart: "2025-01-01",
			value: "高潜池",
		})),
	});
});

test("一次理解发给模型的请求体里没有姓名和工号", async () => {
	const capture = exploreAndCapture();
	let steps: string[] = [];
	try {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "推荐系统, company:星河科技",
		});
		const [row] = await db
			.select({ attempt: searchTurn.attempt })
			.from(searchTurn)
			.where(eq(searchTurn.id, turnId));
		assert.ok(row?.attempt);
		await processTurn(turnId, row.attempt);
		const turn = (await loadThread(OWNER, turnId))?.find(
			(t) => t.id === turnId,
		);
		assert.ok(turn?.spec, "理解完成，条件写进了记录");
		steps = (turn.trace ?? []).map((step) => step.tool);
	} finally {
		capture.stop();
	}
	const { bodies } = capture;
	assert.ok(bodies.length >= 2, "工具的回答跟着第二次请求发了出去");
	/** 一个请求体里带着的工具回答。 */
	const answersIn = (body: string) =>
		(
			JSON.parse(body) as { messages: { role: string; content: string }[] }
		).messages.filter((m) => m.role === "tool");
	const answered = JSON.stringify(
		answersIn(bodies.at(-1) ?? "").map((m) => m.content),
	);
	assert.match(answered, /硕士.{0,8}people.{0,4}3/, "一列的取值和人数发出去了");
	assert.match(answered, /绩效/, "记录流的概况发出去了");
	assert.match(answered, /推荐系统.{0,8}people.{0,4}3/, "捞到的说法发出去了");
	// 读经历是另外的请求，把每一段的公司、岗位、技能发了出去：三个人各一段，写法一样
	const reading = bodies
		.map(
			(body) =>
				JSON.parse(body) as {
					tools?: { function: { name: string } }[];
					messages: { role: string; content: string }[];
				},
		)
		.filter(
			(request) =>
				request.tools?.length === 1 &&
				request.tools[0]?.function.name === "judge",
		);
	assert.equal(reading.length, 1, "三段一批读完");
	const read = reading[0]?.messages.find((m) => m.role === "user")?.content;
	const texts = [
		...(read ?? "").matchAll(
			/入职前的经历，公司：星河科技\\n岗位：首席观星官\\n技能：推荐系统/g,
		),
	];
	assert.equal(texts.length, 3, read ?? "");
	assert.doesNotMatch(answered, /首席观星官/, "经历的文字不进查询理解的对话");
	// 前四个工具是同一次回答里一起用的，谁先记下不一定；读和交结论在它们之后
	assert.deepEqual(steps.slice(0, 4).sort(), [
		"discover",
		"discover",
		"find",
		"probe",
	]);
	assert.deepEqual(steps.slice(4), ["read", "judge"]);
	const prompt = bodies[0] ?? "";
	assert.match(prompt, /档从低到高 C、B、A/, "评级流写档");
	assert.match(prompt, /取值有 高潜池/, "状态流写取值");
	for (const body of bodies)
		for (const secret of [...SECRETS.names, ...SECRETS.empIds])
			assert.ok(!body.includes(secret), `请求体里出现了「${secret}」`);
});

test("接着说的一句话带着之前的对话：前面说过什么、条件怎么变的都在请求里", async () => {
	const first = await createTurn(OWNER, { kind: "sentence", text: "推荐系统" });
	const attemptOf = async (turnId: string) => {
		const [row] = await db
			.select({ attempt: searchTurn.attempt })
			.from(searchTurn)
			.where(eq(searchTurn.id, turnId));
		assert.ok(row?.attempt);
		return row.attempt;
	};
	await processTurn(first.turnId, await attemptOf(first.turnId));
	const capture = exploreAndCapture();
	try {
		const next = await createTurn(
			OWNER,
			{ kind: "sentence", text: "推荐系统, company:星河科技" },
			first.turnId,
		);
		await processTurn(next.turnId, await attemptOf(next.turnId));
	} finally {
		capture.stop();
	}
	const asked = (
		JSON.parse(capture.bodies[0] ?? "{}") as {
			messages: { role: string; content: string }[];
		}
	).messages.find((m) => m.role === "user")?.content;
	assert.match(
		asked ?? "",
		/之前的对话：\nHR：推荐系统\n你：按这些条件找：推荐系统。\n/,
	);
});
