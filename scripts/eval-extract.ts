/**
 * 抽取质量验收：拿已知答案的简历段跑真抽取，报召回与精确。
 *
 * 用法：bun run eval:extract            # 读 evals/extract/*.json
 *      bun run eval:extract 文件.json
 *
 * 用例文件是一个 JSON 数组，每项：
 *   { "name": "A1：Java开发工程师",
 *     "title": "Java开发工程师", "org": "某科技", "description": "负责……",
 *     "gold": [["Java"], ["数据库设计"], ["接口开发", "API 开发"]],  // 每项是一组可接受的写法
 *     "keep": ["售后"],          // 可选：这段必须保住的限定语，出现在任一个词里即算保住
 *     "reject": ["华为"] }       // 可选：不该出现的字样（项目名、公司名）
 *
 * 有 gold 的段量召回与精确：gold 每项抽出任一种写法算命中，抽出的词对不上任何一项算多写。
 * 没有 gold 的段只量形状——动作尾（「……搭建」）、超 8 字、超 10 词——这些不用答案也看得出
 * 提示词是不是走偏了。合成用例进仓库（sample.json，干净克隆也能跑通）；真实段是真人的简历原文，
 * 不进版本库。
 *
 * 走的是派生同一条路（`corpus/extract.ts` 的 `extract`）：当前提示词、当前模型、温度 0，回答进
 * 同一份缓存。同一段、同一提示词、同一模型不会再问端点；改了提示词自然重问。所以这把尺子量的是
 * 「此刻配置下的抽取」，换模型也用它。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extract } from "#/corpus/extract";
import { pool } from "#/db";

type Case = {
	name: string;
	title: string;
	org: string;
	description: string;
	gold: string[][] | null;
	keep: string[];
	reject: string[];
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
		const where = `${file} 第 ${i + 1} 段`;
		for (const key of ["name", "title", "org", "description"])
			if (typeof c[key] !== "string" || !(c[key] as string).trim())
				throw new Error(`${where}：${key} 必须是非空字符串`);
		const gold = c.gold ?? null;
		if (gold !== null && !(Array.isArray(gold) && gold.every(strings)))
			throw new Error(`${where}：gold 是「一组组写法」的数组`);
		if (gold !== null && gold.length === 0)
			throw new Error(
				`${where}：gold 为空量不出任何东西；不知道答案就不要写这个字段`,
			);
		const keep = c.keep ?? [];
		const reject = c.reject ?? [];
		if (!strings(keep) || !strings(reject))
			throw new Error(`${where}：keep 与 reject 只能是字符串数组`);
		return {
			name: c.name as string,
			title: c.title as string,
			org: c.org as string,
			description: c.description as string,
			gold: gold as string[][] | null,
			keep,
			reject,
		};
	});
}

const args = process.argv.slice(2);
const dir = join("evals", "extract");
const files =
	args.length > 0
		? args
		: readdirSync(dir)
				.filter((f) => f.endsWith(".json"))
				.map((f) => join(dir, f));
if (files.length === 0) throw new Error(`${dir} 下没有用例文件`);
const cases = files.flatMap(loadCases);

/** 写法比对：折叠全半角、大小写和空白，「Spring Boot」与「springboot」算同一个。 */
const norm = (word: string) =>
	word.normalize("NFKC").toLowerCase().replace(/\s/g, "");
const ACTION_TAIL = /(建设|搭建|制定|推动|落地|推进|改善|提升|开展)$/;

let goldItems = 0;
let hit = 0;
let written = 0;
let matched = 0;
let keeps = 0;
let kept = 0;
let rejected = 0;
let tails = 0;
let over8 = 0;
let over10 = 0;
try {
	const extractions = await extract(
		cases.map((c) => ({
			kind: "external",
			title: c.title,
			org: c.org,
			description: c.description,
		})),
		(line) => console.error(line),
	);
	for (const [index, c] of cases.entries()) {
		const skills = extractions[index]?.skills ?? [];
		const problems: string[] = [];
		let recall = "";
		if (c.gold) {
			const gold = c.gold;
			const found = gold.filter((group) =>
				skills.some((w) => group.some((a) => norm(a) === norm(w))),
			);
			const extra = skills.filter(
				(w) => !gold.some((group) => group.some((a) => norm(a) === norm(w))),
			);
			goldItems += gold.length;
			hit += found.length;
			written += skills.length;
			matched += skills.length - extra.length;
			recall = `  召回 ${found.length}/${gold.length}`;
			if (found.length < gold.length)
				problems.push(
					`漏了 ${gold
						.filter((group) => !found.includes(group))
						.map((group) => group[0])
						.join("、")}`,
				);
			if (extra.length) problems.push(`多写 ${extra.join("、")}`);
		}
		const lost = c.keep.filter((q) => !skills.some((w) => w.includes(q)));
		keeps += c.keep.length;
		kept += c.keep.length - lost.length;
		if (lost.length) problems.push(`丢了限定语 ${lost.join("、")}`);
		const leaks = skills.filter((w) => c.reject.some((r) => w.includes(r)));
		rejected += leaks.length;
		if (leaks.length) problems.push(`不该出现 ${leaks.join("、")}`);
		const tailed = skills.filter((w) => ACTION_TAIL.test(w));
		const long = skills.filter((w) => [...w].length > 8);
		tails += tailed.length;
		over8 += long.length;
		if (skills.length > 10) over10++;
		if (tailed.length) problems.push(`动作尾 ${tailed.join("、")}`);
		if (long.length) problems.push(`超 8 字 ${long.join("、")}`);
		console.log(
			`${problems.length ? "✗" : "✓"} ${c.name}${recall}  ${skills.join(" | ")}`,
		);
		if (problems.length) console.log(`   ${problems.join("；")}`);
	}
	const pct = (a: number, b: number) =>
		b ? `${Math.round((a / b) * 100)}%` : "—";
	console.log(
		`\n召回 ${hit}/${goldItems}（${pct(hit, goldItems)}），精确 ${matched}/${written}（${pct(matched, written)}），` +
			`限定语保住 ${kept}/${keeps}，不该出现 ${rejected}，动作尾 ${tails}，超 8 字 ${over8}，超 10 词的段 ${over10}，共 ${cases.length} 段`,
	);
	if (hit !== goldItems || kept !== keeps || rejected > 0) process.exitCode = 1;
} finally {
	await pool.end();
}
