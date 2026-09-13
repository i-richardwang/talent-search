/** 命令行跑一条查询，用于验收用例与调参：bun run query "算法 kind:external,+产品,-后端"（语法见 `search/query-syntax.ts`） */

import { pool } from "#/db";
import { dots, period } from "#/lib/format";
import { claimName } from "#/search/condition-label";
import { routeLabel } from "#/search/evidence";
import { parseQuery } from "#/search/query-syntax";
import type { Claim } from "#/search/result";
import { search } from "#/search/search";

/** 一条主张在命令行上怎么写：和一行查询语法同一种写法，对着输入就能核。 */
function claimText(c: Claim) {
	return [
		c.what?.join("/"),
		c.org && `org:${c.org.join("/")}`,
		c.companyTag && `companyTag:${c.companyTag.join("/")}`,
		c.kind && `kind:${c.kind}`,
		c.minMonths && `minMonths:${c.minMonths}`,
	]
		.filter(Boolean)
		.join(" ");
}

const q = process.argv.slice(2).join(" ");
if (!q) throw new Error('用法：bun run query "查询词"');

const t0 = Date.now();
const outcome = await search({ conditions: parseQuery(q) });
if (outcome.order !== "relevance")
	throw new Error("要求查询必须产生相关度结果");
const { claims, results, total } = outcome;
const ms = Date.now() - t0;

const shown = claims.map(claimText).join(", ");
const top = results.slice(0, Number(process.env.TOPN ?? 8));

console.log(`查询「${q}」→ 条件 [${shown}]`);
// 报 total 不报 results.length：后者被 RESULT_PAGE 截过，命中五百人也只会说 50，
// 而这个脚本正是拿来调权重和跑验收用例的——对着一个恒等于页大小的数调参没有意义。
// 「人」这个单位在全站只有一个口径，命令行也不例外。
console.log(`命中 ${total} 人，${ms}ms；以下是分数最高的 ${top.length} 个\n`);
for (const r of top) {
	const e = r.employee;
	console.log(
		`${r.score.toFixed(3)}  ${e.name} ${e.empId}  ${e.curDept} / ${e.curTitle}`,
	);
	const seen = new Set<number>();
	for (const h of r.hits) {
		if (seen.has(h.claim)) continue;
		seen.add(h.claim);
		const name = claimName(claims[h.claim] as Claim);
		// 起止用界面上那一份写法（`lib/format.ts`）：命令行是拿来核对结果的，
		// 两处把同一段经历写成两个样子，对起来就得先在脑子里换一次算。
		console.log(
			`     ${name}${h.value === null || h.value === name ? "" : ` ≈${h.value}`} ←[${routeLabel(h.route)}${h.phrase ? `「${dots(h.involvement, h.phrase)}」` : ""} ${Math.round(h.relevance * 100)}%] ${period(h.startDate, h.endDate)} ${h.org} ${h.title}${h.seq ? ` (${h.seq})` : ""}`,
		);
	}
}
await pool.end();
