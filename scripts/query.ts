/** 命令行跑一条查询，用于验收用例与调参：npm run query -- "算法 产品 后端" */
import { pool } from "#/db";
import { parseChips } from "#/search/parse";
import { search } from "#/search/search";

const q = process.argv.slice(2).join(" ");
if (!q) throw new Error('用法：npx tsx scripts/query.ts "查询词"');

const t0 = Date.now();
const outcome = await search({
	evidence: parseChips(q),
	scope: {},
	notices: [],
});
if (outcome.order !== "relevance")
	throw new Error("概念词查询必须产生相关度结果");
const { terms, results, total } = outcome;
const ms = Date.now() - t0;

const shown = terms.map((t) => t.members.join("/")).join(", ");
const top = results.slice(0, Number(process.env.TOPN ?? 8));

console.log(`查询「${q}」→ 要求 [${shown}]`);
// 报 total 不报 results.length：后者被 RESULT_LIMIT 截过，命中五百人也只会说 50，
// 而这个脚本正是拿来调权重和跑验收用例的——对着一个恒等于页大小的数调参没有意义。
// 「人」这个单位在全站只有一个口径，命令行也不例外。
console.log(`命中 ${total} 人，${ms}ms；以下是分数最高的 ${top.length} 个\n`);
for (const r of top) {
	const e = r.employee;
	console.log(
		`${r.score.toFixed(3)}  ${e.name} ${e.empId}  ${e.curDept} / ${e.curTitle}`,
	);
	const seen = new Set<string>();
	for (const h of r.hits) {
		if (seen.has(h.term)) continue;
		seen.add(h.term);
		const span = `${h.startDate.slice(0, 7)}~${h.endDate?.slice(0, 7) ?? "至今"}`;
		console.log(
			`     ${h.term} ←[${h.route} ${(h.relevance * 100).toFixed(0)}%] ${span} ${h.org} ${h.title}${h.seq ? ` (${h.seq})` : ""}`,
		);
	}
}
await pool.end();
