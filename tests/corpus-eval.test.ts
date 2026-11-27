import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { answerChat, setup } from "./fixture";

after(await setup());
test("两个验收命令使用正式 agent 和独立队列，调用方的待办保持完整", async () => {
	const { pool } = await import("#/db");
	const { collect } = await import("#/corpus/judgment");
	const { guideIdentity } = await import("#/corpus/review-guide");
	await collect(pool, guideIdentity(), [
		{ word: "调用方剩余的合成词", people: 1, near: [] },
	]);
	const dir = await mkdtemp(join(tmpdir(), "talent-eval-"));
	const toolsSeen = new Set<string>();
	const restore = answerChat((_system, _prompt, request) => {
		const tools = (request.tools as { function: { name: string } }[]).map(
			(t) => t.function.name,
		);
		for (const t of tools) toolsSeen.add(t);
		return tools.includes("derive_submit")
			? { items: [] }
			: { kind: "自成一项", target: "", why: "合成判定" };
	});
	try {
		for (const [kind, examples] of [
			[
				"extract",
				[
					{
						name: "合成经历",
						title: "岗位",
						company: "合成企业",
						description: "无具体能力",
						gold: [],
					},
				],
			],
			[
				"review",
				[
					{
						name: "合成词表",
						words: [
							{ word: "技能甲", people: 1 },
							{ word: "技能乙", people: 1 },
						],
						notFound: [["技能甲", "技能乙"]],
					},
				],
			],
		] as const) {
			const file = join(dir, `${kind}.json`);
			await writeFile(file, JSON.stringify(examples));
			await promisify(execFile)(
				process.execPath,
				["--no-env-file", `scripts/eval-${kind}.ts`, file],
				{
					env: {
						PATH: process.env.PATH,
						DATABASE_URL: process.env.DATABASE_URL,
						EXTRACT_BASE_URL: process.env.EXTRACT_BASE_URL,
						EXTRACT_MODEL: "fake",
						REVIEW_MODEL: "review-fake",
						TALENT_SOURCE: "csv-dir",
						TALENT_CSV_DIR: "src/corpus/sources/sample",
					},
					timeout: 25000,
				},
			);
		}
		assert.deepEqual([...toolsSeen].sort(), [
			"derive_list",
			"derive_submit",
			"review_list",
			"review_submit",
		]);
		const { rows } = await pool.query("select word,judge from review_word");
		assert.deepEqual(rows, [{ word: "调用方剩余的合成词", judge: null }]);
	} finally {
		restore();
		await rm(dir, { recursive: true, force: true });
	}
});
