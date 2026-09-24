/**
 * 查询理解验收：拿「当前条件 + 一句话」跑真模型，看新的条件表和说明对不对。
 *
 * 用法：bun run eval:understand            # 读 evals/understand/*.json
 *      bun run eval:understand 文件.json
 *
 * 用例文件是一个 JSON 数组，每项：
 *   { "name": "接着说，去掉一条",
 *     "base": "推荐算法, +org:字节",   // 可选：当前条件，一行查询语法（search/query-syntax.ts）
 *     "say": "不用非得是字节",          // 这一句话
 *     "drop": "+org:字节",             // 可选：新表里必须没有的条件，一行查询语法
 *     "add": ["+团队"],                // 可选：新加的条件里必须提到的词，前缀 + / - 是加分 / 排除
 *     "declined": ["北京"],            // 可选：必须说成搜不了的原话片段
 *     "empty": true,                   // 可选：新表必须是空的
 *     "rewrite": true }                // 可选：这句话换了一件事，不要求保留 base
 *
 * 没有 rewrite 的题，base 里除了 drop 的每一条都必须原样留在新表里——这是这一跳最要紧
 * 的性质：模型不能顺手丢掉或改掉用户没提到的条件。词比对折叠全半角、大小写和空白，
 * 按包含算：模型写「团队管理」也算提到了「团队」。一题只要有一处不对就打叉，退出码
 * 看的是有没有打叉的题。
 *
 * 走的是工作台同一条路（`server/llm.ts` 的 `understand`，再过 `understood` 收窄），用
 * 当前配置的端点和模型；词表从 `.env.local` 那个库里取，和线上发给模型的是同一份。
 * 合成用例进仓库（sample.json）；真实的找人问题不进版本库。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pool } from "#/db";
import { type Condition, conditionKey, type Mode } from "#/search/condition";
import { conditionLabel } from "#/search/condition-label";
import { unanswered, understood } from "#/search/intent";
import { parseQuery } from "#/search/query-syntax";
import { vocabulary } from "#/search/search";
import { detachedTools } from "#/server/agent-tools";
import { understand } from "#/server/llm";

type Case = {
	name: string;
	base: Condition[];
	say: string;
	drop: Condition[];
	add: { mode: Mode; word: string }[];
	declined: string[];
	empty: boolean;
	rewrite: boolean;
};

const strings = (value: unknown): value is string[] =>
	Array.isArray(value) &&
	value.every((x) => typeof x === "string" && Boolean(x.trim()));

function loadCases(file: string): Case[] {
	const data: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (!Array.isArray(data) || data.length === 0)
		throw new Error(`${file}：应是一个非空 JSON 数组，格式见文件头注释`);
	return data.map((raw, i) => {
		const c = (raw ?? {}) as Record<string, unknown>;
		const where = `${file} 第 ${i + 1} 题`;
		if (typeof c.name !== "string" || !c.name.trim())
			throw new Error(`${where}：name 必须是非空字符串`);
		if (typeof c.say !== "string" || !c.say.trim())
			throw new Error(`${where}：say 必须是非空字符串`);
		const syntax = (key: string) => {
			const value = c[key];
			if (value === undefined) return [];
			const parsed = typeof value === "string" ? parseQuery(value) : [];
			if (parsed.length === 0)
				throw new Error(`${where}：${key} 解析不出任何条件`);
			return parsed;
		};
		const list = (key: string) => {
			const value = c[key] ?? [];
			if (!strings(value)) throw new Error(`${where}：${key} 只能是字符串数组`);
			return value.map((x) => x.trim());
		};
		const add = list("add").map((word) =>
			word.startsWith("+")
				? { mode: "boost" as const, word: word.slice(1) }
				: word.startsWith("-")
					? { mode: "exclude" as const, word: word.slice(1) }
					: { mode: "must" as const, word },
		);
		const declined = list("declined");
		const empty = c.empty === true;
		const rewrite = c.rewrite === true;
		const drop = syntax("drop");
		if (!add.length && !declined.length && !drop.length && !empty)
			throw new Error(`${where}：至少要有 add、drop、declined、empty 之一`);
		return {
			name: c.name.trim(),
			base: syntax("base"),
			say: c.say.trim(),
			drop,
			add,
			declined,
			empty,
			rewrite,
		};
	});
}

const args = process.argv.slice(2);
const dir = join("evals", "understand");
const files =
	args.length > 0
		? args
		: readdirSync(dir)
				.filter((f) => f.endsWith(".json"))
				.map((f) => join(dir, f));
if (files.length === 0) throw new Error(`${dir} 下没有用例文件`);
const cases = files.flatMap(loadCases);

const norm = (word: string) =>
	word.normalize("NFKC").toLowerCase().replace(/\s/g, "");

/** 一条条件里写下的全部词：经历词、公司名、公司档、人的取值。 */
function wordsOf(condition: Condition): string[] {
	return condition.about === "person"
		? [...condition.values]
		: [
				...(condition.what ?? []),
				...(condition.org ?? []),
				...(condition.companyTag ?? []),
			];
}

let failed = 0;
try {
	const vocab = await vocabulary();
	for (const c of cases) {
		const problems: string[] = [];
		let summary = "";
		try {
			const raw = await understand(
				c.say,
				vocab,
				c.base,
				await detachedTools(c.base),
			);
			const result = understood(raw, vocab, c.base);
			const failure = unanswered(raw, result);
			if (failure) problems.push(failure);
			const next = result.spec.conditions;
			const has = new Set(next.map(conditionKey));
			const dropped = new Set(c.drop.map(conditionKey));

			if (!c.rewrite)
				for (const kept of c.base)
					if (!dropped.has(conditionKey(kept)) && !has.has(conditionKey(kept)))
						problems.push(`没保住「${conditionLabel(kept)}」`);
			for (const gone of c.drop)
				if (has.has(conditionKey(gone)))
					problems.push(`没去掉「${conditionLabel(gone)}」`);

			const had = new Set(c.base.map(conditionKey));
			const added = next.filter((one) => !had.has(conditionKey(one)));
			for (const { mode, word } of c.add)
				if (
					!added.some(
						(one) =>
							one.mode === mode &&
							wordsOf(one).some((w) => norm(w).includes(norm(word))),
					)
				)
					problems.push(`没加上「${word}」（${mode}）`);

			const said = result.notes?.declined.map((d) => d.said) ?? [];
			for (const word of c.declined)
				if (!said.some((s) => norm(s).includes(norm(word))))
					problems.push(`没说「${word}」搜不了`);
			if (c.empty && next.length > 0) problems.push("条件表应当是空的");

			summary = [
				next
					.map(
						(one) =>
							conditionLabel(one) +
							(one.mode === "must" ? "" : `(${one.mode})`),
					)
					.join("、") || "（空）",
				...(result.notes?.assumed ?? []).map((a) => `读法：${a}`),
				...(result.notes?.declined ?? []).map(
					(d) => `搜不了：${d.said}——${d.why}`,
				),
			].join(" | ");
		} catch (e) {
			problems.push(e instanceof Error ? e.message : String(e));
		}
		if (problems.length > 0) failed++;
		console.log(`${problems.length === 0 ? "✓" : "✗"} ${c.name}`);
		if (summary) console.log(`   ${summary}`);
		for (const p of problems) console.log(`   ! ${p}`);
	}
	console.log(`\n${cases.length - failed}/${cases.length} 题通过`);
	if (failed > 0) process.exitCode = 1;
} finally {
	await pool.end();
}
