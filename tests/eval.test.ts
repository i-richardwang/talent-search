/** eval 是提交门禁：打印红字不够，调用方必须拿到非零退出码。 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
	]);
});

function run(expect: string) {
	const file = join(dir, `${expect}.json`);
	writeFileSync(
		file,
		JSON.stringify([{ name: "评估退出码", query: "算法", expect: [expect] }]),
	);
	return spawnSync(
		process.execPath,
		["--import", "tsx", "scripts/eval.ts", file],
		{
			cwd: process.cwd(),
			env: process.env,
			encoding: "utf8",
		},
	);
}

describe("评估门禁", () => {
	test("全部召回时成功", () => {
		assert.equal(run("V001").status, 0);
	});

	test("漏掉任一已知答案时失败", () => {
		assert.equal(run("V999").status, 1);
	});
});
