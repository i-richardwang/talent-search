/**
 * 整理质量验收：拿一组组短说法让判定方判，按判定生效后搜索会带出谁来计分。
 *
 * 用法：bun run eval:review                        # 读 evals/review/*.json，自带模型作答
 *      bun run eval:review 文件.json
 *      bun run eval:review --export 考题.json      # 写出判定标准和各题的词，给外部判定方
 *      bun run eval:review --answers 答案.json     # 给外部判定方的回答打分
 *
 * 外部判定方拿到的和判定接口给的一样：`guide` 是判定标准全文，每题 `{ name, words }`；
 * 回答是 `[{ name, judgments }]`，`judgments` 和提交判定时的写法一样。
 *
 * 用例文件是一个 JSON 数组，每项是一组词和搜索上必须成立的结果：
 *   { "name": "数据分析",
 *     "words": [{ "word": "数据分析", "people": 40 }, { "word": "销售数据分析", "people": 6 }, …],
 *     "found": [["数据分析", "销售数据分析"]],      // 搜前一个词，写了后一个词的人要出来
 *     "notFound": [["销售数据分析", "数据分析"]] }  // 搜前一个词，写了后一个词的人不能出来
 *
 * 答案只写会改变搜索结果的要求：说得通的几种判法都满足的不写，判定方选哪一种都算对。
 * 前一个词可以不在组里（判定方会起的更宽的词）。违反 notFound 是混人：搜的人看到不符合要求的人；
 * 违反 found 是漏人：词表本该带出的人没出来，只剩重排自己认得出的那部分。另查起出来的归属名
 * 是不是能力词的写法（超 8 字、带「能力」「相关」「工作」的都不是招聘的人会点的）。验收共用生产的
 * `conform` 与 `merge`，从本题建立词表，按检索修正命中的方向判断带不带出。每个题词都必须作答；
 * 任何一项失败均返回非零退出码。
 *
 * 合成用例进仓库（sample.json）；真实组是从库里分组得到的词，不进版本库。自带模型作答时调用与整理
 * 判定相同的入口（`corpus/vocabulary.ts` 的 `askModel`）：当前提示词、`REVIEW_MODEL`、温度 0，
 * 回答进同一份缓存。
 */

import "@tanstack/react-start/server-only";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Member } from "#/corpus/judgment";
import { askModel, GUIDE } from "#/corpus/vocabulary";
import { conform, merge, type Table } from "#/corpus/vocabulary-rules";
import { pool } from "#/db";

type Case = {
	name: string;
	words: Member[];
	found: [string, string][];
	notFound: [string, string][];
};

const pairs = (value: unknown): value is [string, string][] =>
	Array.isArray(value) &&
	value.every(
		(p) =>
			Array.isArray(p) &&
			p.length === 2 &&
			p.every((x) => typeof x === "string" && x.length > 0),
	);

function loadCases(file: string): Case[] {
	const data: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (!Array.isArray(data) || data.length === 0)
		throw new Error(`${file}：应是一个非空 JSON 数组，格式见文件头注释`);
	return data.map((raw, i) => {
		const c = (raw ?? {}) as Record<string, unknown>;
		const where = `${file} 第 ${i + 1} 题`;
		if (typeof c.name !== "string" || !c.name.trim())
			throw new Error(`${where}：name 必须是非空字符串`);
		const words = c.words;
		if (
			!Array.isArray(words) ||
			words.length < 2 ||
			!words.every(
				(m) =>
					typeof m === "object" &&
					m !== null &&
					typeof (m as Member).word === "string" &&
					typeof (m as Member).people === "number",
			)
		)
			throw new Error(
				`${where}「${c.name}」：words 至少两项，每项 { word, people }`,
			);
		const found = c.found ?? [];
		const notFound = c.notFound ?? [];
		if (!pairs(found) || !pairs(notFound))
			throw new Error(`${where}「${c.name}」：found 和 notFound 是词对的数组`);
		if (found.length === 0 && notFound.length === 0)
			throw new Error(`${where}「${c.name}」：没有答案的题无法衡量`);
		const known = new Set((words as Member[]).map((m) => m.word));
		for (const [, word] of [...found, ...notFound])
			if (!known.has(word))
				throw new Error(
					`${where}「${c.name}」：答案里的「${word}」不在 words 里`,
				);
		return { name: c.name, words: words as Member[], found, notFound };
	});
}

const { values: flags, positionals } = parseArgs({
	allowPositionals: true,
	options: { answers: { type: "string" }, export: { type: "string" } },
});
const dir = join("evals", "review");
const files =
	positionals.length > 0
		? positionals
		: readdirSync(dir)
				.filter((f) => f.endsWith(".json"))
				.map((f) => join(dir, f));
if (files.length === 0) throw new Error(`${dir} 下没有用例文件`);
const cases = files.flatMap(loadCases);
if (new Set(cases.map((c) => c.name)).size !== cases.length)
	throw new Error("题名重复：外部判定方的回答按题名对应");

if (flags.export) {
	writeFileSync(
		flags.export,
		`${JSON.stringify(
			{
				guide: GUIDE,
				groups: cases.map((c) => ({ name: c.name, words: c.words })),
			},
			null,
			"\t",
		)}\n`,
	);
	console.log(`写出 ${cases.length} 题到 ${flags.export}`);
	process.exit(0);
}

/** 外部判定方的回答，按题名排回题目顺序；没答的题是 undefined，计为没有得到回答。 */
function answersFrom(file: string): (unknown | undefined)[] {
	const data: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (!Array.isArray(data))
		throw new Error(`${file}：应是 [{ name, judgments }] 数组`);
	const byName = new Map<string, unknown>();
	for (const item of data)
		if (typeof item?.name === "string") byName.set(item.name, item);
	return cases.map((c) => byName.get(c.name));
}

/** 招聘的人不会点的归属名：太长，或者是「……能力」「……相关」这种概括。 */
const UNCLICKABLE = /(能力|相关|工作|事务|方面|类$|等$)/;

/**
 * 搜 `query` 会不会顺着词表带出写了 `word` 的人：和检索修正命中同一个方向，
 * 同一个标准词的写法和它下面一层层的细词都带出来，往上不带。
 */
function carries(table: Table, query: string, word: string): boolean {
	const canonical = (w: string) => table.get(w)?.canonical ?? w;
	const target = canonical(query);
	const seen = new Set<string>();
	let at: string | null = canonical(word);
	while (at !== null && !seen.has(at)) {
		if (at === target) return true;
		seen.add(at);
		const parent: string | null = table.get(at)?.parent ?? null;
		at = parent === null ? null : canonical(parent);
	}
	return false;
}

let found = 0;
let missed = 0;
let notFound = 0;
let mixed = 0;
let unclickable = 0;
const names = new Set<string>();
let failed = 0;
try {
	const payloads = flags.answers
		? answersFrom(flags.answers)
		: await askModel(
				cases.map((c) => c.words),
				(line) => console.error(line),
			);
	for (const [index, c] of cases.entries()) {
		const words = c.words.map((m) => m.word);
		const verdicts = conform(payloads[index], words);
		const problems: string[] = [];
		if (payloads[index] === undefined) problems.push("没有得到回答");
		const unanswered = words.filter((word) => !verdicts.has(word));
		if (unanswered.length) problems.push(`漏答 ${unanswered.join("、")}`);
		const table: Table = new Map();
		merge(table, c.words, verdicts, new Date());
		const lost = c.found.filter(([q, w]) => !carries(table, q, w));
		found += c.found.length;
		missed += lost.length;
		if (lost.length)
			problems.push(
				`漏人 ${lost.map(([q, w]) => `搜${q}不带${w}`).join("、")}`,
			);
		const wrong = c.notFound.filter(([q, w]) => carries(table, q, w));
		notFound += c.notFound.length;
		mixed += wrong.length;
		if (wrong.length)
			problems.push(
				`混人 ${wrong.map(([q, w]) => `搜${q}带出${w}`).join("、")}`,
			);
		const bad: string[] = [];
		for (const decision of table.values()) {
			const parent = decision.parent;
			if (parent === null) continue;
			names.add(parent);
			if ([...parent].length > 8 || UNCLICKABLE.test(parent)) bad.push(parent);
		}
		unclickable += bad.length;
		if (bad.length) problems.push(`归属名不像能力词 ${bad.join("、")}`);
		const said = words
			.map((word) => {
				if (!verdicts.has(word)) return `${word}（漏答）`;
				const canonical = table.get(word)?.canonical ?? word;
				const parent = table.get(canonical)?.parent;
				return `${word}${canonical === word ? "" : `=${canonical}`}${parent ? `∈${parent}` : ""}`;
			})
			.join(" | ");
		console.log(`${problems.length ? "✗" : "✓"} ${c.name}  ${said}`);
		if (problems.length) {
			failed++;
			console.log(`   ${problems.join("；")}`);
		}
	}
	console.log(
		`\n混人 ${mixed}/${notFound}，漏人 ${missed}/${found}，归属名不像能力词 ${unclickable}，` +
			`起了 ${names.size} 个不同的归属名，${failed} 题没过，共 ${cases.length} 题`,
	);
	if (failed > 0) process.exitCode = 1;
} finally {
	await pool.end();
}
