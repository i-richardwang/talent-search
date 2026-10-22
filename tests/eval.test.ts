/** eval 是提交门禁：打印红字不够，调用方必须拿到非零退出码。 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { answerChat, seed, setup } from "./fixture";

const teardown = await setup();
const dir = mkdtempSync(join(tmpdir(), "talent-eval-"));
after(async () => {
	rmSync(dir, { recursive: true });
	await teardown();
});

before(async () => {
	await seed([
		{
			empId: "V001",
			name: "评估样例",
			segments: [{ seqL2: "算法", months: 12 }],
		},
		{
			empId: "V002",
			name: "只被第二个取值找到",
			segments: [{ seqL2: "运算", months: 12 }],
		},
	]);
});

/**
 * 子进程要向本进程里的假嵌入端点要向量，所以这里**不能用 spawnSync**：
 * 它会卡住本进程的事件循环，端点答不了，子进程也退不了，互相等死。
 * 返回退出码；子进程的输出直通终端，失败时能直接看到它报了什么。
 */
function run(expect: string, reject: string[] = []) {
	const file = join(dir, `${expect}-${reject.join("-")}.json`);
	writeFileSync(
		file,
		JSON.stringify([
			{ name: "评估退出码", query: "算法/运算", expect: [expect], reject },
		]),
	);
	const child = spawn(process.execPath, ["scripts/eval.ts", file], {
		cwd: process.cwd(),
		env: process.env,
		stdio: "inherit",
	});
	return new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
}

describe("评估门禁", () => {
	test("全部召回时成功", async () => {
		assert.equal(await run("V001"), 0);
	});

	test("漏掉任一已知答案时失败", async () => {
		assert.equal(await run("V999"), 1);
	});

	test("放进了已确认不该出现的人也失败：只报召回的话多塞词永远是「变好」", async () => {
		assert.equal(await run("V001", ["V002"]), 1);
		assert.equal(await run("V001", ["V999"]), 0);
	});
});

let corpusCase = 0;
async function runCorpus(
	kind: "extract" | "review",
	cases: unknown[],
	answer: unknown,
) {
	const file = join(dir, `${kind}-${++corpusCase}.json`);
	writeFileSync(file, JSON.stringify(cases));
	const restore = answerChat(() => answer);
	try {
		const child = spawn(process.execPath, [`scripts/eval-${kind}.ts`, file], {
			cwd: process.cwd(),
			env: process.env,
			stdio: "ignore",
		});
		return await new Promise<number | null>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", resolve);
		});
	} finally {
		restore();
	}
}

describe("语料验收门禁", () => {
	test("无 gold 的抽取用例仍要求合法回答，合法空结果可以通过", async () => {
		const c = {
			name: "形状",
			title: "合成岗位",
			company: "合成公司",
			description: "合成描述状态",
		};
		assert.equal(await runCorpus("extract", [c], { items: "invalid" }), 1);
		assert.equal(await runCorpus("extract", [c], { items: [] }), 0);
	});
	test("抽取的精确率问题也使验收失败", async () => {
		const c = {
			name: "精确",
			title: "合成岗位",
			company: "合成公司",
			description: "合成精确描述",
			gold: [{ words: ["数据分析"] }],
		};
		const said = (...texts: string[]) => ({
			items: texts.map((text) => ({ text, depth: "做过" })),
		});
		assert.equal(
			await runCorpus("extract", [c], said("数据分析", "需求分析")),
			1,
		);
		// 写了不算错的写法另列，不算多写
		assert.equal(
			await runCorpus(
				"extract",
				[{ ...c, ok: ["需求分析"] }],
				said("数据分析", "需求分析"),
			),
			0,
		);
	});
	test("投入档判错也使验收失败，两档都对的写法判成哪一档都通过", async () => {
		// 每次换一段描述：同一段的回答进了缓存，第二次不会再问
		const judged = (depth: string) =>
			runCorpus(
				"extract",
				[
					{
						name: "档",
						title: "合成岗位",
						company: "合成公司",
						description: `合成档描述${depth}`,
						gold: [{ words: ["数据分析"], depth: "主导|做过" }],
					},
				],
				{ items: [{ text: "数据分析", depth }] },
			);
		assert.equal(await judged("提到"), 1);
		assert.equal(await judged("做过"), 0);
		assert.equal(await judged("主导"), 0);
	});
	test("只要求了一部分词的题也检查每个词的作答覆盖", async () => {
		const words = ["数据分析", "数据统计", "团队管理"].map((word) => ({
			word,
			people: 3,
		}));
		const c = {
			name: "覆盖",
			words,
			found: [["数据分析", "数据统计"]],
			notFound: [["数据统计", "团队管理"]],
		};
		assert.equal(
			await runCorpus("review", [c], {
				judgments: [
					{ word: "数据分析", why: "同义", sameAs: "数据统计", parent: "" },
				],
			}),
			1,
		);
	});
	test("带不带出按生产归并的最终结果验收", async () => {
		const words = [
			{ word: "数据分析", people: 10 },
			{ word: "数据统计", people: 3 },
		];
		const c = {
			name: "生效",
			words,
			found: [
				["数据分析", "数据统计"],
				["业务分析", "数据统计"],
			],
		};
		const judgments = [
			{ word: "数据分析", why: "归属", sameAs: "", parent: "业务分析" },
			{ word: "数据统计", why: "同义", sameAs: "数据分析", parent: "报表分析" },
		];
		assert.equal(await runCorpus("review", [c], { judgments }), 0);
	});
});
