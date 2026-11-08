/**
 * 发给查询理解模型的只有人数和写法：抓下一次完整理解发出的每一个请求体（假模型先把看目录、
 * 查经历词、试跑都用一遍，工具的回答会跟着下一次请求发出去），里面不能有任何一个人的姓名、
 * 工号、岗位、部门名或经历原文。数据全是合成的。
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { exploreAndCapture, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { createTurn, interpret, loadThread } = await import("#/server/turn");
const { db } = await import("#/db");
const { searchTurn, recordStream, scale, employeeRecord } = await import(
	"#/db/schema"
);
const { eq } = await import("drizzle-orm");

/** 每个人身上只属于他自己的东西：一样都不该出现在请求体里。 */
const SECRETS = {
	names: ["龙骧甲", "龙骧乙", "龙骧丙"],
	empIds: ["ZQ7301", "ZQ7302", "ZQ7303"],
	title: "首席观星官",
	department: "玄武七部",
	description: "主导鲲鹏九号的召回链路改造",
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
					title: SECRETS.title,
					extracted: { skills: ["推荐系统"] },
				},
				{
					months: 12,
					department: SECRETS.department,
					departmentPath: `星河事业部/${SECRETS.department}`,
					title: SECRETS.title,
					// 没读过的段：整段原文是它的说法
					description: SECRETS.description,
				},
			],
		})),
	);
	await db.insert(recordStream).values({
		stream: "perf",
		kind: "rating",
		label: "绩效",
		period: "半年",
	});
	await db
		.insert(scale)
		.values(
			["C", "B", "A"].map((value, rank) => ({ stream: "perf", value, rank })),
		);
	await db.insert(employeeRecord).values(
		SECRETS.empIds.map((empId) => ({
			empId,
			stream: "perf",
			periodStart: "2025-01-01",
			periodEnd: "2025-06-30",
			value: "A",
		})),
	);
	await db
		.insert(recordStream)
		.values({ stream: "hipo", kind: "status", label: "高潜" });
	await db.insert(employeeRecord).values(
		SECRETS.empIds.map((empId) => ({
			empId,
			stream: "hipo",
			periodStart: "2025-01-01",
			value: "高潜池",
		})),
	);
});

test("一次理解发给模型的请求体里没有人", async () => {
	const capture = exploreAndCapture();
	try {
		const { turnId } = await createTurn({
			kind: "sentence",
			text: "推荐系统, company:星河科技",
		});
		const [row] = await db
			.select({ attempt: searchTurn.interpretAttempt })
			.from(searchTurn)
			.where(eq(searchTurn.id, turnId));
		assert.ok(row?.attempt);
		await interpret(turnId, row.attempt);
		const turn = (await loadThread(turnId))?.find((t) => t.id === turnId);
		assert.ok(turn?.spec, "理解完成，条件写进了记录");
	} finally {
		capture.stop();
	}
	const { bodies } = capture;
	assert.ok(bodies.length >= 2, "工具的回答跟着第二次请求发了出去");
	const { messages } = JSON.parse(bodies.at(-1) ?? "{}") as {
		messages: { role: string; content: unknown }[];
	};
	const answered = JSON.stringify(
		messages.filter((m) => m.role === "tool").map((m) => m.content),
	);
	assert.match(answered, /硕士.{0,8}people.{0,4}3/, "一列的取值和人数发出去了");
	assert.match(answered, /绩效/, "记录流的概况发出去了");
	const prompt = bodies[0] ?? "";
	assert.match(prompt, /档从低到高 C、B、A/, "评级流写档");
	assert.match(prompt, /取值有 高潜池/, "状态流写取值");
	for (const body of bodies)
		for (const secret of [
			...SECRETS.names,
			...SECRETS.empIds,
			SECRETS.title,
			SECRETS.department,
			SECRETS.description,
		])
			assert.ok(!body.includes(secret), `请求体里出现了「${secret}」`);
});
