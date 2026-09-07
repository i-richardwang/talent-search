/** 命令行跑一条查询，用于验收用例与调参：bun run query "算法,+产品,-后端"（语法见 `search/query-syntax.ts`） */
import { pool } from "#/db";
import { dots, period } from "#/lib/format";
import { parseQuery } from "#/search/query-syntax";
import { search } from "#/search/search";

const q = process.argv.slice(2).join(" ");
if (!q) throw new Error('用法：bun run query "查询词"');

const t0 = Date.now();
const outcome = await search({
	requirements: parseQuery(q),
	scope: {},
	notices: [],
});
if (outcome.order !== "relevance")
	throw new Error("要求查询必须产生相关度结果");
const { terms, results, total } = outcome;
const ms = Date.now() - t0;

const SIGN = { said: "", same: "=", near: "~" } as const;
const shown = terms
	.map((t) => t.members.map((m) => SIGN[m.tier] + m.text).join("/"))
	.join(", ");
const top = results.slice(0, Number(process.env.TOPN ?? 8));

console.log(`查询「${q}」→ 要求 [${shown}]`);
// 报 total 不报 results.length：后者被 RESULT_PAGE 截过，命中五百人也只会说 50，
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
		// 起止用界面上那一份写法（`lib/format.ts`）：命令行是拿来核对结果的，
		// 两处把同一段经历写成两个样子，对起来就得先在脑子里换一次算。
		console.log(
			`     ${h.term}${h.member.tier === "said" ? "" : ` ≈${h.member.text}`} ←[${h.route}${h.phrase ? `「${dots(h.involvement, h.phrase)}」` : ""} ${Math.round(h.relevance * 100)}%] ${period(h.startDate, h.endDate)} ${h.org} ${h.title}${h.seq ? ` (${h.seq})` : ""}`,
		);
	}
}
await pool.end();
