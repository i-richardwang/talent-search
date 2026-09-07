/**
 * 检索质量验收：拿业务方给的「已知答案的找人问题」跑真检索，报召回与名次。
 *
 * 用法：bun run eval            # 读 evals/*.json
 *      bun run eval 文件.json
 *
 * 用例文件是一个 JSON 数组，每项：
 *   { "name": "找有支付风控经验的人",
 *     "query": "支付/风控/~风险控制,+带团队",  // 一行查询语法，见 search/query-syntax.ts
 *     "expect": ["E1001", "E2042"],        // 已确认应当出现的工号
 *     "reject": ["E3007"] }                // 可选：已确认不该出现的工号
 *
 * `reject` 量的是精度。补变体这类改动同时可能找回漏掉的人和放进不相干的人，
 * 只报召回的话，往查询里多塞几个词永远是「变好」。
 * 真实评估用例不进版本库（题目和答案指向真人）；仓库只带 `evals/sample.json`——
 * 全部指向合成样例语料（etl/sources/sample/）的可执行基线，干净克隆也能跑通。
 *
 * 这把尺子存在的意义：提示词、权重、说法档位都会被大幅调整，而每次调整既可能
 * 找回漏掉的人、也可能放进不相干的人——没有基线就分不清是变好还是变坏。
 * query 用一行查询语法而不是原话，是刻意的：这里量的是**检索与排序**，不含模型
 * 理解那一跳的方差；理解的对错由 tests/intent.test.ts 和人工评审管。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pool } from "#/db";
import { parseQuery } from "#/search/query-syntax";
import { search } from "#/search/search";
import { RESULT_MAX } from "#/search/weights";

type Case = { name: string; query: string; expect: string[]; reject: string[] };

/**
 * 形状校验从严：尺子最大的罪是给虚假读数。没有 expect 的题会得出 0/0，
 * 界面上却是一个绿色的 ✓——那不是「暂时没答案」，是一次谎报，所以直接报错。
 */
function loadCases(file: string): Case[] {
	const data: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (!Array.isArray(data) || data.length === 0)
		throw new Error(`${file}：应是一个非空 JSON 数组，格式见文件头注释`);
	return data.map((raw, i) => {
		const c = (raw ?? {}) as Record<string, unknown>;
		const where = `${file} 第 ${i + 1} 题`;
		if (typeof c.name !== "string" || !c.name.trim())
			throw new Error(`${where}：name 必须是非空字符串`);
		const name = c.name.trim();
		if (typeof c.query !== "string" || parseQuery(c.query).length === 0)
			throw new Error(`${where}「${name}」：query 解析不出任何条件`);
		const rawExpect = c.expect;
		if (
			!Array.isArray(rawExpect) ||
			rawExpect.length === 0 ||
			!rawExpect.every(
				(x): x is string => typeof x === "string" && Boolean(x.trim()),
			)
		)
			throw new Error(
				`${where}「${name}」：expect 至少要有一个已确认的工号——没有期望的题什么都量不出来`,
			);
		const expect = rawExpect.map((x) => x.trim());
		if (new Set(expect).size !== expect.length)
			throw new Error(`${where}「${name}」：expect 里有重复工号`);
		const rawReject = c.reject ?? [];
		if (
			!Array.isArray(rawReject) ||
			!rawReject.every(
				(x): x is string => typeof x === "string" && Boolean(x.trim()),
			)
		)
			throw new Error(`${where}「${name}」：reject 只能是工号数组`);
		const reject = rawReject.map((x) => x.trim());
		if (reject.some((id) => expect.includes(id)))
			throw new Error(`${where}「${name}」：同一个工号不能既 expect 又 reject`);
		return { name, query: c.query, expect, reject };
	});
}

const args = process.argv.slice(2);
let files: string[];
if (args.length > 0) {
	files = args;
} else {
	try {
		files = readdirSync("evals")
			.filter((f) => f.endsWith(".json"))
			.map((f) => join("evals", f));
	} catch {
		throw new Error(
			"evals/ 目录不存在。仓库自带 evals/sample.json；真实评估用例放进同目录即可（不进版本库）",
		);
	}
}
if (files.length === 0) throw new Error("evals/ 下没有用例文件");

const cases: Case[] = files.flatMap(loadCases);

let recalled = 0;
let expected = 0;
let intruded = 0;
try {
	for (const c of cases) {
		const outcome = await search(
			{ requirements: parseQuery(c.query), scope: {}, notices: [] },
			{},
			RESULT_MAX,
		);
		if (outcome.order !== "relevance")
			throw new Error(`${c.name}：要求用例没有产生相关度结果`);
		const { results, total, empty } = outcome;
		const rankOf = new Map(results.map((r, i) => [r.employee.empId, i + 1]));
		const found = c.expect.filter((id) => rankOf.has(id));
		const intruders = c.reject.filter((id) => rankOf.has(id));
		recalled += found.length;
		expected += c.expect.length;
		intruded += intruders.length;
		const marks = [
			...c.expect.map((id) =>
				rankOf.has(id) ? `${id}@${rankOf.get(id)}` : `${id}✗`,
			),
			...intruders.map((id) => `${id}!@${rankOf.get(id)}`),
		].join(" ");
		const ok = found.length === c.expect.length && intruders.length === 0;
		console.log(
			`${ok ? "✓" : "✗"} ${c.name}` +
				`  召回 ${found.length}/${c.expect.length}` +
				(c.reject.length > 0
					? `，误召 ${intruders.length}/${c.reject.length}`
					: "") +
				`，命中 ${total} 人${
					empty?.kind === "overflowEvidence"
						? `（匹配事实过多：${empty.terms.join("、")}）`
						: ""
				}`,
		);
		console.log(`   ${marks}`);
	}
	console.log(
		`\n总召回 ${recalled}/${expected}（${expected ? Math.round((recalled / expected) * 100) : 0}%），误召 ${intruded}，共 ${cases.length} 题`,
	);
	if (recalled !== expected || intruded > 0) process.exitCode = 1;
} finally {
	await pool.end();
}
