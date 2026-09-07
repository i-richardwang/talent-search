/** eval 是提交门禁：打印红字不够，调用方必须拿到非零退出码。 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { seed, setup } from "./fixture";

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
			name: "只被变体找到",
			segments: [{ seqL2: "运算", months: 12 }],
		},
	]);
});

/**
 * 子进程要向本进程里的假嵌入端点要向量，所以这里**不能用 spawnSync**：
 * 它会卡住本进程的事件循环，端点答不了，子进程退不了，两边互相等。
 * 返回退出码；子进程的输出直通终端，失败时能直接看到它报了什么。
 */
function run(expect: string, reject: string[] = []) {
	const file = join(dir, `${expect}-${reject.join("-")}.json`);
	writeFileSync(
		file,
		JSON.stringify([
			{ name: "评估退出码", query: "算法/~运算", expect: [expect], reject },
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
