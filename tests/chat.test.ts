import assert from "node:assert/strict";
import { createServer } from "node:http";
import { text } from "node:stream/consumers";
import { after, test } from "node:test";
import { answerChat, setup } from "./fixture";

const teardown = await setup();
after(teardown);
process.env.EXTRACT_TIMEOUT_MS = "900";
process.env.EXTRACT_API_KEY = "synthetic-extract-only";
const { evaluateExtraction, experienceAnswers } = await import(
	"../scripts/evaluation/corpus"
);
const example = {
	kind: "external" as const,
	unemployed: false,
	title: "合成岗位",
	company: "合成公司",
	description: "合成描述",
};
const quiet = () => {};

test("对齐 agent 在同名模型上使用对齐端点的凭据，未配置密钥时也能独立使用", async () => {
	const target = process.env.EXTRACT_BASE_URL;
	assert.ok(target);
	const seen = new Set<string | undefined>();
	const server = createServer(async (req, res) => {
		seen.add(req.headers.authorization);
		const response = await fetch(
			new URL("chat/completions", target.endsWith("/") ? target : `${target}/`),
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: await text(req),
			},
		);
		res
			.writeHead(response.status, { "content-type": "application/json" })
			.end(await response.text());
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address === "object");
	const restore = answerChat(() => ({ seq: "" }));
	try {
		process.env.ALIGN_BASE_URL = `http://127.0.0.1:${address.port}`;
		for (const key of ["synthetic-align-only", undefined]) {
			if (key) process.env.ALIGN_API_KEY = key;
			else delete process.env.ALIGN_API_KEY;
			seen.clear();
			const answers = await experienceAnswers(
				"align",
				[{ ...example, description: `测试 ${key ?? "无密钥"}` }],
				[["技术", "算法"]],
				quiet,
			);
			assert.deepEqual(answers, [{ seq: "" }]);
			assert.deepEqual([...seen], [key ? `Bearer ${key}` : undefined]);
		}
	} finally {
		restore();
		delete process.env.ALIGN_BASE_URL;
		delete process.env.ALIGN_API_KEY;
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

test("对话时限覆盖整批工具调用，超时的题仍可领取", async () => {
	const resume = Promise.withResolvers<void>();
	const restore = answerChat(async () => {
		await resume.promise;
		return { items: [] };
	});
	try {
		const start = Date.now();
		await assert.rejects(evaluateExtraction([example], quiet), {
			name: "TimeoutError",
		});
		assert.ok(Date.now() - start < 3000);
		const { pool } = await import("#/db");
		assert.equal(
			(
				await pool.query(
					"select count(*)::int as n from derive_request where result is null and failed_version is null",
				)
			).rows[0].n,
			1,
		);
	} finally {
		resume.resolve();
		restore();
	}
});

test("字段名出现在经历原文时，模型缓存仍区分岗位与公司", async () => {
	const first = { ...example, title: "甲\n公司：乙", company: "丙" };
	const second = { ...example, title: "甲", company: "乙\n公司：丙" };
	let calls = 0;
	const restore = answerChat(() => ({
		items: [{ text: ++calls === 1 ? "计算" : "管理", depth: "做过" }],
	}));
	try {
		await evaluateExtraction([first], quiet);
		const secondResult = await evaluateExtraction([second], quiet);
		assert.equal(calls, 2);
		assert.deepEqual(secondResult, [
			{
				status: "done",
				value: { items: [{ text: "管理", engagement: "做过" }] },
			},
		]);
		assert.deepEqual(await evaluateExtraction([second], quiet), secondResult);
		assert.equal(calls, 2);
	} finally {
		restore();
	}
});
