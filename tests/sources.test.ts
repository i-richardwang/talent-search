import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSource, sourceConfig } from "#/corpus/sources";

test("数据源配置只有内置样例或明确的运行时模块路径", () => {
	const before = process.env.TALENT_SOURCE;
	try {
		delete process.env.TALENT_SOURCE;
		assert.deepEqual(sourceConfig(), { name: "csv-dir", modulePath: null });

		process.env.TALENT_SOURCE = "/opt/talent/company-adapter.ts";
		assert.deepEqual(sourceConfig(), {
			name: "company-adapter",
			modulePath: "/opt/talent/company-adapter.ts",
		});
	} finally {
		if (before === undefined) delete process.env.TALENT_SOURCE;
		else process.env.TALENT_SOURCE = before;
	}
});

test("私有适配器从构建产物之外的绝对路径加载", async () => {
	const directory = await mkdtemp(join(tmpdir(), "talent-source-"));
	const modulePath = join(directory, "private-source.mjs");
	try {
		await writeFile(
			modulePath,
			"export async function extract() { return { employees: [], assignments: [], external: [] }; }\n",
		);
		const source = await loadSource({ name: "private-source", modulePath });
		assert.deepEqual(await source.extract(() => {}), {
			employees: [],
			assignments: [],
			external: [],
		});
	} finally {
		await rm(directory, { recursive: true });
	}
});

test("私有适配器不接受依赖工作目录的相对路径", async () => {
	await assert.rejects(
		loadSource({ name: "private-source", modulePath: "private-source.ts" }),
		(error: unknown) =>
			error instanceof Error &&
			error.message === "读取数据源 private-source 失败" &&
			error.cause instanceof Error &&
			error.cause.message.includes("绝对路径"),
	);
});
