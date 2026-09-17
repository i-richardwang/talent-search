/**
 * 外部判定方那道口子的形状：认人、收窄入参、提交的几种下场。
 *
 * 判定本身在 `vocabulary.test.ts` 里走完整一轮；这里只管接口自己那一层——凭据对不对、
 * `limit` 怎么收窄、什么样的判定根本进不了库。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { authorized, configured, limitOf, submit } = await import(
	"#/server/review"
);
const { openGroups } = await import("#/corpus/judgment");
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

	test("判定不归外部时，凭据正确也不放行", () => {
		process.env.REVIEW_TOKEN = TOKEN;
		for (const judge of ["model", "off"]) {
			process.env.REVIEW_JUDGE = judge;
			assert.equal(configured(), false, `REVIEW_JUDGE=${judge} 该关着`);
			assert.equal(authorized(bearer(`Bearer ${TOKEN}`)), false);
		}
		process.env.REVIEW_JUDGE = "external";
	});

	test("开启后只认配置的那个 token，未带和带错都拒绝", () => {
		process.env.REVIEW_TOKEN = TOKEN;
		assert.equal(configured(), true);
		assert.equal(authorized(bearer(`Bearer ${TOKEN}`)), true);
		assert.equal(authorized(bearer("Bearer wrong-token")), false);
		assert.equal(authorized(bearer(TOKEN)), false);
		assert.equal(authorized(new Request("http://x/api/review")), false);
	});
});

describe("取组的 limit", () => {
	test("缺失、非法、超上限一律收窄，不否掉整次请求", () => {
		assert.equal(limitOf("http://x/api/review"), 20);
		assert.equal(limitOf("http://x/api/review?limit=abc"), 20);
		assert.equal(limitOf("http://x/api/review?limit=0"), 20);
		assert.equal(limitOf("http://x/api/review?limit=-3"), 20);
		assert.equal(limitOf("http://x/api/review?limit=5"), 5);
		assert.equal(limitOf("http://x/api/review?limit=9999"), 100);
	});
});

describe("提交判定的形状", () => {
	const judgments = [{ word: "数据分析工作", why: "同义", alias: true }];

	test("格式不对的判定不写库", async () => {
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
			const got = await submit(request(body));
			assert.equal(got.ok, false, `${JSON.stringify(body)} 该被拦下`);
			assert.match(got.ok ? "" : got.why, why);
		}
	});

	test("超过上限的判定不解析", async () => {
		const got = await submit(request({ id: 1, big: "x".repeat(70_000) }));
		assert.equal(got.ok, false);
		assert.match(got.ok ? "" : got.why, /太大/);
	});
});

describe("提交判定", () => {
	let id = 0;

	before(async () => {
		await seed([
			{
				empId: "R001",
				name: "甲",
				segments: [
					{ kind: "external", months: 12, extracted: { skills: ["数据分析"] } },
				],
			},
		]);
		const connection = await pool.connect();
		try {
			const { rows } = await connection.query<{ id: number }>(
				`insert into review_group (kind, words)
				 values ('group', '[{"word":"数据分析","people":3},{"word":"数据分析工作","people":2}]'::jsonb)
				 returning id`,
			);
			id = rows[0]?.id ?? 0;
		} finally {
			connection.release();
		}
	});

	test("原话原样存进组里，这里不收窄", async () => {
		// 「别的词」不在组里、`sameAs` 指向外人——两样都留到生效时才被 `conform` 丢掉
		const raw = [
			{ word: "数据分析工作", why: "同义", sameAs: "数据分析", parent: "" },
			{ word: "别的词", why: "…", sameAs: "外人", parent: "" },
		];
		const got = await submit(request({ id, judge: "hr-bot", judgments: raw }));
		assert.deepEqual(got, { ok: true, submission: "accepted" });

		const connection = await pool.connect();
		try {
			const { rows } = await connection.query<{
				judge: string;
				judgment: { judgments: unknown[] };
			}>("select judge, judgment from review_group where id = $1", [id]);
			assert.equal(rows[0]?.judge, "agent:hr-bot");
			assert.deepEqual(rows[0]?.judgment.judgments, raw);
			// 判过的组不再出现在待判的那一份里
			assert.equal(
				(await openGroups(connection)).some(
					(one: { id: number }) => one.id === id,
				),
				false,
			);
		} finally {
			connection.release();
		}
	});

	test("第二份判定不算，不存在的组分开说", async () => {
		const judgments = [
			{ word: "数据分析工作", why: "同义", sameAs: "数据分析", parent: "" },
		];
		assert.deepEqual(
			await submit(request({ id, judge: "another", judgments })),
			{ ok: true, submission: "taken" },
		);
		assert.deepEqual(
			await submit(request({ id: 10_000_000, judge: "hr-bot", judgments })),
			{ ok: true, submission: "missing" },
		);
	});
});
