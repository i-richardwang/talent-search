/**
 * 外部判定方 HTTP 接口的形状：鉴权、入参校验、提交的几种结果。
 *
 * 判定在 `vocabulary.test.ts` 里走完整一轮；这里只管接口自己那一层——凭据对不对、
 * `limit` 怎么校验、什么样的判定根本进不了库。
 */
import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { authorized, configured, limitOf, pending, submit } = await import(
	"#/server/review"
);
const { openWords } = await import("#/corpus/judgment");
const { guideIdentity } = await import("#/corpus/vocabulary");
const { pool } = await import("#/db");

const TOKEN = "test-token";

test("判定已持久化时，调度故障不把接收结果改成失败", async () => {
	const { Route } = await import("#/routes/api/review");
	const previousJudge = process.env.REVIEW_JUDGE;
	const previousToken = process.env.REVIEW_TOKEN;
	process.env.REVIEW_JUDGE = "external";
	process.env.REVIEW_TOKEN = TOKEN;
	const logged = mock.method(console, "error", () => {});
	try {
		const { rows } = await pool.query<{ id: number }>(
			`insert into review_word (guide_identity, word, people, near)
			 values ($1, '合成调度能力', 3, '[]'::jsonb) returning id`,
			[guideIdentity()],
		);
		const id = rows[0]?.id;
		assert.ok(id);
		const input = request({
			id,
			guideIdentity: guideIdentity(),
			judge: "synthetic",
			judgment: { why: "独立能力", kind: "自成一项", target: "" },
		});
		input.headers.set("authorization", `Bearer ${TOKEN}`);
		const handlers = Route.options.server?.handlers;
		assert.ok(handlers && typeof handlers !== "function");
		const post = handlers.POST;
		assert.equal(typeof post, "function");
		assert.ok(typeof post === "function");
		const response = await post({ request: input } as Parameters<
			typeof post
		>[0]);
		assert.ok(response instanceof Response);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { accepted: true });
		assert.equal(
			(await pool.query("select judge from review_word where id = $1", [id]))
				.rows[0]?.judge,
			"agent:synthetic",
		);
		assert.equal(logged.mock.callCount(), 1);
		assert.match(
			String(logged.mock.calls[0]?.arguments[1]),
			/后台任务没有启动/,
		);
	} finally {
		logged.mock.restore();
		if (previousJudge === undefined) delete process.env.REVIEW_JUDGE;
		else process.env.REVIEW_JUDGE = previousJudge;
		if (previousToken === undefined) delete process.env.REVIEW_TOKEN;
		else process.env.REVIEW_TOKEN = previousToken;
	}
});

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

describe("鉴权", () => {
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
		// 凭据对不对已经不重要了：接口没开
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

	test("未知的整理模式直接报错", () => {
		process.env.REVIEW_JUDGE = "typo";
		assert.throws(() => configured(), /REVIEW_JUDGE=typo 无效/);
		process.env.REVIEW_JUDGE = "external";
	});
});

describe("取词的 limit", () => {
	test("缺失、非法用默认值，超上限取上限，不否掉整次请求", () => {
		assert.equal(limitOf("http://x/api/review"), 20);
		assert.equal(limitOf("http://x/api/review?limit=abc"), 20);
		assert.equal(limitOf("http://x/api/review?limit=0"), 20);
		assert.equal(limitOf("http://x/api/review?limit=-3"), 20);
		assert.equal(limitOf("http://x/api/review?limit=5"), 5);
		assert.equal(limitOf("http://x/api/review?limit=9999"), 100);
	});
});

describe("提交判定的形状", () => {
	const judgment = { why: "同义", kind: "同一件事", target: "数据分析" };
	const identity = guideIdentity();

	test("格式不对的判定不写库", async () => {
		for (const [body, why] of [
			["不是 JSON", /不是 JSON/],
			[[1, 2, 3], /缺 id/],
			[{ judge: "hr-bot", judgment }, /缺 id/],
			[{ id: 1.5, judge: "hr-bot", judgment }, /缺 id/],
			[{ id: 1, judgment }, /guideIdentity/],
			[{ id: 1, guideIdentity: "old", judgment }, /guideIdentity/],
			[{ id: 1, guideIdentity: identity, judgment }, /judge/],
			[
				{ id: 1, guideIdentity: identity, judge: "名字里有汉字", judgment },
				/judge/,
			],
			[
				{ id: 1, guideIdentity: identity, judge: "a".repeat(41), judgment },
				/judge/,
			],
			[
				{ id: 1, guideIdentity: identity, judge: "hr-bot" },
				/judgment 不是对象/,
			],
			[
				{ id: 1, guideIdentity: identity, judge: "hr-bot", judgment: [] },
				/judgment 不是对象/,
			],
			[
				{
					id: 1,
					guideIdentity: identity,
					judge: "hr-bot",
					judgment: "同一件事",
				},
				/judgment 不是对象/,
			],
			[
				{ id: 1, guideIdentity: identity, judge: "hr-bot", judgment: null },
				/judgment 不是对象/,
			],
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

	test("流式正文越过上限立即取消，不等待发送结束或信任长度头", async () => {
		let reads = 0;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					reads++;
					controller.enqueue(new Uint8Array(32 * 1024));
				},
				cancel() {
					cancelled = true;
				},
			},
			{ highWaterMark: 0 },
		);
		const result = await submit(
			new Request("http://x/api/review", {
				method: "POST",
				headers: { "content-length": "1" },
				body,
			}),
		);
		assert.deepEqual(result, { ok: false, why: "这份判定太大" });
		assert.equal(reads, 3);
		assert.equal(cancelled, true);
	});

	test("判定上限按 UTF-8 字节计算", async () => {
		const body = JSON.stringify({ id: 1, big: "词".repeat(23_000) });
		assert.ok(body.length < 64 * 1024);
		assert.ok(Buffer.byteLength(body, "utf8") > 64 * 1024);
		assert.deepEqual(await submit(request(body)), {
			ok: false,
			why: "这份判定太大",
		});
	});

	test("大小在解码前核验，UTF-8 BOM 也计入正文", async () => {
		const raw = JSON.stringify({ id: 1 }).padEnd(64 * 1024, " ");
		assert.deepEqual(await submit(request(raw)), {
			ok: false,
			why: "缺 guideIdentity",
		});
		const bytes = new TextEncoder().encode(`\uFEFF${raw}`);
		assert.deepEqual(
			await submit(
				new Request("http://x/api/review", { method: "POST", body: bytes }),
			),
			{ ok: false, why: "这份判定太大" },
		);
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
				`insert into review_word (guide_identity, word, people, near)
				 values ($1, '数据分析工作', 2, '[{"word":"数据分析","people":3}]'::jsonb)
				 returning id`,
				[guideIdentity()],
			);
			id = rows[0]?.id ?? 0;
		} finally {
			connection.release();
		}
	});

	test("取词同时给出词、参考词与标准的同一份身份", async () => {
		const view = await pending(20);
		const word = view.words.find((one) => one.id === id);
		assert.ok(word);
		assert.equal(word.word, "数据分析工作");
		assert.equal(word.people, 2);
		assert.deepEqual(word.near, [{ word: "数据分析", people: 3 }]);
		assert.equal(word.guideIdentity, guideIdentity());
		assert.equal(view.guide.identity, word.guideIdentity);
		assert.match(view.guide.text, /同一件事/);
	});

	test("原话原样存在词上，这里不校验内容", async () => {
		// `kind` 不是四种之一、`target` 指向参考词以外的词——都留到生效时才被 `conform` 丢掉
		const raw = { why: "…", kind: "差不多", target: "外人", extra: 1 };
		const got = await submit(
			request({
				guideIdentity: guideIdentity(),
				id,
				judge: "hr-bot",
				judgment: raw,
			}),
		);
		assert.deepEqual(got, { ok: true, submission: "accepted" });

		const connection = await pool.connect();
		try {
			const { rows } = await connection.query<{
				judge: string;
				judgment: unknown;
			}>("select judge, judgment from review_word where id = $1", [id]);
			assert.equal(rows[0]?.judge, "agent:hr-bot");
			assert.deepEqual(rows[0]?.judgment, raw);
			// 判过的词不再出现在待判的那一份里
			assert.equal(
				(await openWords(connection, guideIdentity())).some(
					(one) => one.id === id,
				),
				false,
			);
		} finally {
			connection.release();
		}
	});

	test("第二份判定不算，不存在的词分开说", async () => {
		const judgment = { why: "同义", kind: "同一件事", target: "数据分析" };
		assert.deepEqual(
			await submit(
				request({
					guideIdentity: guideIdentity(),
					id,
					judge: "another",
					judgment,
				}),
			),
			{ ok: true, submission: "taken" },
		);
		assert.deepEqual(
			await submit(
				request({
					guideIdentity: guideIdentity(),
					id: 10_000_000,
					judge: "hr-bot",
					judgment,
				}),
			),
			{ ok: true, submission: "missing" },
		);
		assert.deepEqual(
			await submit(
				request({
					guideIdentity: "0".repeat(64),
					id,
					judge: "hr-bot",
					judgment,
				}),
			),
			{ ok: true, submission: "missing" },
		);
	});
});
