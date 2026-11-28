import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Writable } from "node:stream";
import { text } from "node:stream/consumers";
import { after, type TestContext, test } from "node:test";
import {
	Client,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
	answerChat,
	answerCorpusStep,
	answerEmbedding,
	fakeEmbedding,
	seed,
	setup,
} from "./fixture";

const teardown = await setup({ corpusWriter: true });
after(teardown);
const { Route } = await import("#/routes/api/mcp/$scope");
const { runTask } = await import("#/server/tasks");

async function connect(t: TestContext, url: URL, token: string) {
	const client = new Client({ name: "synthetic-agent", version: "1" });
	t.after(() => client.close());
	await client.connect(
		new StreamableHTTPClientTransport(url, {
			requestInit: { headers: { authorization: `Bearer ${token}` } },
		}),
	);
	return client;
}

async function call(
	client: Client,
	name: string,
	args: Record<string, unknown>,
) {
	const result = await client.callTool({ name, arguments: args });
	const block = result.content[0];
	assert.ok(block?.type === "text");
	assert.ok(!result.isError, block.text);
	assert.deepEqual(result.structuredContent, JSON.parse(block.text));
	return JSON.parse(block.text);
}

test("外部 agent 凭各自的凭据，通过 Streamable HTTP 领取并交回解析与词表判定", async (t) => {
	const tokens = {
		DERIVE_TOKEN: "synthetic-derive",
		REVIEW_TOKEN: "synthetic-review",
	};
	Object.assign(process.env, tokens, {
		DERIVE_MODE: "external",
		REVIEW_JUDGE: "external",
	});
	for (const kind of ["sync", "derive"] as const)
		assert.equal((await runTask(kind))?.failure, null);

	const contentTypes = new Set<string | null>();
	const http = createServer(async (req, res) => {
		try {
			const path = new URL(req.url ?? "/", "http://localhost");
			const scope = path.pathname.split("/").pop() ?? "";
			assert.equal(path.pathname, `/api/mcp/${scope}`);
			const handlers = Route.options.server?.handlers;
			assert.ok(handlers && typeof handlers !== "function");
			const handler =
				req.method === "GET"
					? handlers.GET
					: req.method === "DELETE"
						? handlers.DELETE
						: handlers.POST;
			assert.ok(typeof handler === "function");
			const headers = new Headers();
			for (const [name, value] of Object.entries(req.headers))
				if (value !== undefined) headers.set(name, String(value));
			const request = new Request(path, {
				method: req.method,
				headers,
				body: req.method === "POST" ? await text(req) : undefined,
			});
			const response = await handler({
				request,
				params: { scope },
			} as Parameters<typeof handler>[0]);
			assert.ok(response instanceof Response);
			contentTypes.add(
				response.headers.get("content-type")?.split(";")[0] ?? null,
			);
			res.writeHead(response.status, Object.fromEntries(response.headers));
			if (response.body) await response.body.pipeTo(Writable.toWeb(res));
			else res.end();
		} catch (error) {
			res.writeHead(500).end(String(error));
		}
	});
	await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		http.closeAllConnections();
		http.close();
	});
	const address = http.address();
	assert.ok(address && typeof address === "object");
	const origin = `http://127.0.0.1:${address.port}`;
	process.env.BETTER_AUTH_URL = origin;
	const deriveUrl = new URL("/api/mcp/derive", origin);
	const reviewUrl = new URL("/api/mcp/review", origin);
	const derive = await connect(t, deriveUrl, tokens.DERIVE_TOKEN);
	const review = await connect(t, reviewUrl, tokens.REVIEW_TOKEN);
	assert.deepEqual(
		(await derive.listTools()).tools.map((tool) => tool.name).sort(),
		["derive_list", "derive_submit"],
	);
	assert.deepEqual(
		(await review.listTools()).tools.map((tool) => tool.name).sort(),
		["review_list", "review_submit"],
	);
	const bearer = { authorization: `Bearer ${tokens.REVIEW_TOKEN}` };
	assert.equal((await fetch(deriveUrl)).status, 401);
	assert.equal((await fetch(deriveUrl, { headers: bearer })).status, 401);
	assert.equal(
		(
			await fetch(reviewUrl, {
				headers: { ...bearer, origin: "https://other.invalid" },
			})
		).status,
		403,
	);
	assert.equal(
		(await fetch(reviewUrl, { headers: { ...bearer, host: "other.invalid" } }))
			.status,
		403,
	);
	assert.equal((await fetch(reviewUrl, { headers: bearer })).status, 405);
	assert.equal(
		(
			await fetch(reviewUrl, {
				method: "POST",
				headers: { ...bearer, "content-type": "application/json" },
				body: " ".repeat(65 * 1024),
			})
		).status,
		413,
	);
	for (const kind of ["extract", "align"]) {
		const { standard, inputs, instructions, schema } = await call(
			derive,
			"derive_list",
			{ kind, limit: 100 },
		);
		assert.ok(inputs.length > 0);
		assert.ok(instructions && schema);
		const { id } = inputs[0];
		const result =
			kind === "extract"
				? { items: [{ text: "合成能力", depth: "做过" }] }
				: { seq: "" };
		const response = await call(derive, "derive_submit", {
			kind,
			standard,
			results: [
				{ id, result: {} },
				...inputs.map(({ id }: { id: number }) => ({ id, result })),
				{ id, unable: true },
			],
		});
		assert.deepEqual(response.results, [
			{ id, status: "invalid" },
			...inputs.map(({ id }: { id: number }) => ({ id, status: "accepted" })),
			{ id, status: "conflict" },
		]);
		assert.deepEqual((await call(derive, "derive_list", { kind })).inputs, []);
	}
	for (const kind of ["derive", "review"] as const)
		assert.equal((await runTask(kind))?.failure, null);
	const { words, guide } = await call(review, "review_list", { limit: 1 });
	assert.equal(words.length, 1);
	assert.equal(guide.identity, words[0].guideIdentity);
	const answer = {
		id: words[0].id,
		guideIdentity: guide.identity,
		judge: "synthetic",
		judgment: { kind: "自成一项", why: "合成测试", target: "" },
	};
	process.env.DERIVE_TOKEN = tokens.REVIEW_TOKEN;
	try {
		assert.equal((await fetch(reviewUrl, { headers: bearer })).status, 404);
	} finally {
		process.env.DERIVE_TOKEN = tokens.DERIVE_TOKEN;
	}
	const invalid = await review.callTool({
		name: "review_submit",
		arguments: {
			...answer,
			judgment: { kind: "同一件事", why: "合成反例", target: words[0].word },
		},
	});
	assert.deepEqual(invalid.structuredContent, {
		status: "invalid",
		error: "判定不符合当前词和参考词的指南",
	});
	assert.deepEqual(await call(review, "review_submit", answer), {
		accepted: true,
	});
	const duplicate = await review.callTool({
		name: "review_submit",
		arguments: answer,
	});
	assert.ok(duplicate.isError && duplicate.content[0]?.type === "text");
	assert.deepEqual(duplicate.structuredContent, {
		error: "这个词已经有人判过了",
		status: "taken",
	});
	assert.equal((await runTask("review"))?.failure, null);
	const { pool } = await import("#/db");
	const term = await pool.query("select reviewed_at from term where word=$1", [
		words[0].word,
	]);
	assert.ok(term.rows[0]?.reviewed_at);
	assert.ok(contentTypes.has("text/event-stream"));
	process.env.REVIEW_JUDGE = "off";
	assert.equal((await fetch(reviewUrl, { headers: bearer })).status, 404);
});

test("内置 agent 按本批编号交卷，只回复文字不能完成任务，重试复用已接收的答案", async () => {
	process.env.DERIVE_MODE = "model";
	const { pool } = await import("#/db");
	const { deriveProgress } = await import("#/server/tasks");
	assert.equal((await runTask("sync"))?.failure, null);
	await pool.query("delete from derive_request");
	await pool.query("delete from completion_cache");
	await pool.query("update experience set derived_identity = null");
	let accepted: number | undefined;
	const feedback: unknown[] = [];
	const remove = answerCorpusStep((replies, kind) => {
		if (!replies.length) return [["derive_list", { kind, limit: 2 }]];
		const batch = replies[0] as { standard: string; inputs: { id: number }[] };
		const first = batch.inputs[0]?.id;
		if (replies.length === 2) feedback.push(replies[1]?.error);
		if (replies.length >= 3) {
			feedback.push(replies[2]?.results);
			return "处理完毕";
		}
		if (replies.length === 2) accepted = first;
		return [
			[
				"derive_submit",
				{
					kind,
					standard: batch.standard,
					results: [
						{
							id: replies.length === 1 ? 2147483647 : first,
							result: { items: [] },
						},
					],
				},
			],
		];
	});
	try {
		assert.match(
			(await runTask("derive"))?.failure ?? "",
			/tool call|未完成本批工具调用/,
		);
	} finally {
		remove();
	}
	assert.ok(accepted);
	assert.match(String(feedback[0]), /本批/);
	assert.deepEqual(feedback[1], [{ id: accepted, status: "accepted" }]);
	const saved = await pool.query(
		"select id from derive_request where result is not null",
	);
	assert.deepEqual(saved.rows, [{ id: accepted }]);
	const retried = new Set<number>();
	const restore = answerChat((system, _prompt, request) => {
		const messages = request.messages as { role: string; content: string }[];
		const batch = JSON.parse(
			messages.find((row) => row.role === "tool")?.content ?? "{}",
		);
		for (const row of batch.inputs) retried.add(row.id);
		return system.includes("HR 整理") ? { items: [] } : { seq: "" };
	});
	try {
		assert.equal((await runTask("derive"))?.failure, null);
	} finally {
		restore();
	}
	assert.ok(retried.size && !retried.has(accepted));
	const state = await deriveProgress();
	assert.equal(state.done, state.total);
});

test("内置 agent 等待模型时可同步，解析任务保持运行且同类任务不会重复启动", async () => {
	const { pool } = await import("#/db");
	const { tasksState } = await import("#/server/tasks");
	process.env.DERIVE_MODE = "model";
	assert.equal((await runTask("sync"))?.failure, null);
	await pool.query("delete from derive_request");
	await pool.query("delete from completion_cache");
	await pool.query("update experience set derived_identity = null");
	const asked = Promise.withResolvers<void>();
	const resume = Promise.withResolvers<void>();
	const restore = answerChat(async (system) => {
		asked.resolve();
		await resume.promise;
		return system.includes("HR 整理") ? { items: [] } : { seq: "" };
	});
	const task = runTask("derive");
	try {
		await Promise.race([
			asked.promise,
			task.then((result) => {
				throw new Error(result?.failure ?? "没有进入模型步骤");
			}),
		]);
		assert.equal((await runTask("sync"))?.failure, null);
		assert.equal(await runTask("derive"), null);
		const lane = (await tasksState()).lanes.find(
			(row) => row.kind === "derive",
		);
		assert.equal(lane?.latest?.outcome, "running");
	} finally {
		resume.resolve();
		try {
			assert.equal((await task)?.failure, null);
		} finally {
			restore();
		}
	}
});

test("整理等待嵌入期间允许同步，取回写者锁后按当前经历收集词", async () => {
	const { pool } = await import("#/db");
	const { guideIdentity } = await import("#/corpus/review-guide");
	const { openWords } = await import("#/corpus/judgment");
	await pool.query("delete from review_word");
	await seed([
		{
			personId: "embed-writer-fixture",
			name: "合成整理样例",
			segments: [
				{
					kind: "external",
					months: 1,
					extracted: { skills: ["等待时删除的词"] },
				},
			],
		},
	]);
	process.env.REVIEW_JUDGE = "external";
	const entered = Promise.withResolvers<void>();
	const resume = Promise.withResolvers<void>();
	const restore = answerEmbedding(async (text) => {
		entered.resolve();
		await resume.promise;
		return fakeEmbedding(text);
	});
	const review = runTask("review");
	try {
		await Promise.race([
			entered.promise,
			review.then(() => {
				throw new Error("没有进入嵌入步骤");
			}),
		]);
		assert.equal((await runTask("sync"))?.failure, null);
		assert.equal(await runTask("review"), null);
	} finally {
		resume.resolve();
		try {
			assert.equal((await review)?.failure, null);
		} finally {
			restore();
		}
	}
	assert.ok(
		!(await openWords(pool, guideIdentity())).some(
			(q) => q.word === "等待时删除的词",
		),
	);
});
