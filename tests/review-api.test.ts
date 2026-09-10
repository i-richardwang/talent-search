/**
 * 外部裁判那道口子的形状：认人、收窄入参、交卷的几种下场。
 *
 * 判卷本身在 `aliases.test.ts` 里走完整一轮；这里只管接口自己那一层——凭据对不对、
 * `limit` 怎么收窄、什么样的答卷根本进不了库。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { answer, authorized, configured, limitOf } = await import(
	"#/server/review"
);
const { openQuestions } = await import("#/corpus/aliases");
const { pool } = await import("#/db");

const TOKEN = "test-token";

function request(body: unknown): Request {
	return new Request("http://x/api/review", {
		method: "POST",
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

function bearer(value: string): Request {
	return new Request("http://x/api/review", {
		headers: { authorization: value },
	});
}

describe("认人", () => {
	const judgeBefore = process.env.REVIEW_JUDGE;
	before(() => {
		process.env.REVIEW_JUDGE = "external";
	});
	after(() => {
		if (judgeBefore === undefined) delete process.env.REVIEW_JUDGE;
		else process.env.REVIEW_JUDGE = judgeBefore;
		delete process.env.REVIEW_TOKEN;
	});

	test("没配 token 时这条路根本不通", () => {
		delete process.env.REVIEW_TOKEN;
		assert.equal(configured(), false);
		// 凭据对不对已经不重要了：没开这道口子
		assert.equal(authorized(bearer(`Bearer ${TOKEN}`)), false);
	});

	test("判卷不归外部时，凭据配对了也不开门", () => {
		process.env.REVIEW_TOKEN = TOKEN;
		for (const judge of ["model", "off"]) {
			process.env.REVIEW_JUDGE = judge;
			assert.equal(configured(), false, `REVIEW_JUDGE=${judge} 该关着`);
			assert.equal(authorized(bearer(`Bearer ${TOKEN}`)), false);
		}
		process.env.REVIEW_JUDGE = "external";
	});

	test("开了就只认那一串，没带和带错一样", () => {
		process.env.REVIEW_TOKEN = TOKEN;
		assert.equal(configured(), true);
		assert.equal(authorized(bearer(`Bearer ${TOKEN}`)), true);
		assert.equal(authorized(bearer("Bearer wrong-token")), false);
		assert.equal(authorized(bearer(TOKEN)), false);
		assert.equal(authorized(new Request("http://x/api/review")), false);
	});
});

describe("拉题的 limit", () => {
	test("缺失、非法、超上限一律收窄，不作废整次请求", () => {
		assert.equal(limitOf("http://x/api/review"), 20);
		assert.equal(limitOf("http://x/api/review?limit=abc"), 20);
		assert.equal(limitOf("http://x/api/review?limit=0"), 20);
		assert.equal(limitOf("http://x/api/review?limit=-3"), 20);
		assert.equal(limitOf("http://x/api/review?limit=5"), 5);
		assert.equal(limitOf("http://x/api/review?limit=9999"), 100);
	});
});

describe("交卷的形状", () => {
	const judgments = [{ word: "数据分析工作", why: "同义", alias: true }];

	test("形状不对的答卷进不了库", async () => {
		for (const [body, why] of [
			["不是 JSON", /不是 JSON/],
			[[1, 2, 3], /缺 id/],
			[{ judge: "hr-bot", judgments }, /缺 id/],
			[{ id: 1.5, judge: "hr-bot", judgments }, /缺 id/],
			[{ id: 1, judgments }, /judge/],
			[{ id: 1, judge: "名字里有汉字", judgments }, /judge/],
			[{ id: 1, judge: "a".repeat(41), judgments }, /judge/],
			[{ id: 1, judge: "hr-bot" }, /judgments/],
			[{ id: 1, judge: "hr-bot", judgments: "都并" }, /judgments/],
		] as [unknown, RegExp][]) {
			const got = await answer(request(body));
			assert.equal(got.ok, false, `${JSON.stringify(body)} 该被拦下`);
			assert.match(got.ok ? "" : got.why, why);
		}
	});

	test("超过上限的答卷不解析", async () => {
		const got = await answer(request({ id: 1, big: "x".repeat(70_000) }));
		assert.equal(got.ok, false);
		assert.match(got.ok ? "" : got.why, /太大/);
	});
});

describe("交卷", () => {
	let id = 0;

	before(async () => {
		await seed([
			{
				empId: "R001",
				name: "甲",
				segments: [{ kind: "external", months: 12, skills: ["数据分析"] }],
			},
		]);
		const connection = await pool.connect();
		try {
			const { rows } = await connection.query<{ id: number }>(
				`insert into skill_review (head, candidates)
				 values ('数据分析', '[{"word":"数据分析工作","people":2}]'::jsonb)
				 returning id`,
			);
			id = rows[0]?.id ?? 0;
		} finally {
			connection.release();
		}
	});

	test("原话原样存进题里，这里不收窄", async () => {
		// 「别的词」不在候选里、`alias` 是字符串——两样都留到结算时才被 `conform` 丢掉
		const raw = [
			{ word: "数据分析工作", why: "同义", alias: true },
			{ word: "别的词", why: "…", alias: "true" },
		];
		const got = await answer(request({ id, judge: "hr-bot", judgments: raw }));
		assert.deepEqual(got, { ok: true, submission: "accepted" });

		const connection = await pool.connect();
		try {
			const { rows } = await connection.query<{
				judge: string;
				answer: { judgments: unknown[] };
			}>("select judge, answer from skill_review where id = $1", [id]);
			assert.equal(rows[0]?.judge, "agent:hr-bot");
			assert.deepEqual(rows[0]?.answer.judgments, raw);
			// 答过的题不再出现在拉题里
			assert.equal(
				(await openQuestions(connection)).some((one) => one.id === id),
				false,
			);
		} finally {
			connection.release();
		}
	});

	test("第二份答卷不算，不存在的题分开说", async () => {
		const judgments = [{ word: "数据分析工作", why: "同义", alias: true }];
		assert.deepEqual(
			await answer(request({ id, judge: "another", judgments })),
			{ ok: true, submission: "taken" },
		);
		assert.deepEqual(
			await answer(request({ id: 10_000_000, judge: "hr-bot", judgments })),
			{ ok: true, submission: "missing" },
		);
	});
});
