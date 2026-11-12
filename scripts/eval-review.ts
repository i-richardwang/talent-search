/**
 * 整理质量验收：拿一个个用例里的短说法让判定方判，按判定生效后点一个词会带出谁来计分。
 * 词表让一个词带出两种人：同一项的其他写法（搜索和筛选都带），以及它下面的细词（只在筛选栏
 * 点宽的那一项时带）。这里按筛选栏的口径判，它包含搜索带出的那部分。
 *
 * 用法：bun run eval:review                        # 读 evals/review/*.json，自带模型作答
 *      bun run eval:review 文件.json
 *      bun run eval:review --export 用例.json      # 写出判定标准和各用例要判的词，给外部判定方
 *      bun run eval:review --answers 答案.json     # 给外部判定方的回答打分
 *
 * 一个用例里的每个词各判一次，参考词是这个用例里的其他词，和整理时一个词配几个参考词是
 * 同一种问法。外部判定方拿到的和判定接口给的一样：`guide` 是判定标准全文，每个用例
 * `{ name, words }`，`words` 的每项是 `{ word, people, near }`；回答是 `[{ name, judgments }]`，
 * `judgments` 的每项是 `{ word, why, kind, target }`，后三项和提交判定时的写法一样。
 *
 * 用例文件是一个 JSON 数组，每项是一批词和必须成立的结果：
 *   { "name": "数据分析",
 *     "words": [{ "word": "数据分析", "people": 40 }, { "word": "销售数据分析", "people": 6 }, …],
 *     "found": [["数据分析", "销售数据分析"]],      // 点前一个词，写了后一个词的人要出来
 *     "notFound": [["销售数据分析", "数据分析"]],   // 点前一个词，写了后一个词的人不能出来
 *     "excluded": ["策略会"] }                      // 必须判成不是能力的词
 *
 * 答案只写会改变带出结果的要求：说得通的几种判法都满足的不写，判定方选哪一种都算对。
 * 前一个词可以不在用例里（判定方会起的更宽的词）。违反 notFound 是混人：找的人看到不符合要求的人；
 * 违反 found 是漏人：词表本该带出的人没出来。`excluded` 里的词没判成不是能力是没删掉；
 * 别的词判成不是能力是误删。另查起出来的归属名是不是能力词的写法（超 8 字、
 * 带「能力」「相关」「工作」的都不是招聘的人会点的）。验收共用生产的 `conform` 与 `place`，
 * 从这个用例建立词表再判断带不带出。用例里的每个词都必须作答；任何一项失败均返回非零退出码。
 *
 * 合成用例进仓库（sample.json）；真实的词是从库里取的，不进版本库。自带模型作答时调用与整理
 * 判定相同的入口（`corpus/vocabulary.ts` 的 `askModel`）：当前提示词、`REVIEW_MODEL`、温度 0，
 * 回答进同一份缓存。
 */

import "@tanstack/react-start/server-only";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Member, Question } from "#/corpus/judgment";
import { askModel, GUIDE } from "#/corpus/vocabulary";
import { conform, place, type Table } from "#/corpus/vocabulary-rules";
import { pool } from "#/db";

type Case = {
	name: string;
	words: Member[];
	found: [string, string][];
	notFound: [string, string][];
	excluded: string[];
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
		const where = `${file} 第 ${i + 1} 个用例`;
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
		const excluded = c.excluded ?? [];
		if (!pairs(found) || !pairs(notFound))
			throw new Error(`${where}「${c.name}」：found 和 notFound 是词对的数组`);
		if (
			!Array.isArray(excluded) ||
			!excluded.every((word) => typeof word === "string")
		)
			throw new Error(`${where}「${c.name}」：excluded 是词的数组`);
		if (found.length + notFound.length + excluded.length === 0)
			throw new Error(`${where}「${c.name}」：没有答案的用例无法衡量`);
		const known = new Set((words as Member[]).map((m) => m.word));
		for (const word of [
			...[...found, ...notFound].map(([, word]) => word),
			...excluded,
		])
			if (!known.has(word))
				throw new Error(
					`${where}「${c.name}」：答案里的「${word}」不在 words 里`,
				);
		return {
			excluded,
			found,
			name: c.name,
			notFound,
			words: words as Member[],
		};
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
	throw new Error("用例名重复：外部判定方的回答按用例名对应");

/** 一个用例里要判的词：每个词的参考词是这个用例里的其他词。 */
const questionsOf = (c: Case): Question[] =>
	c.words.map((one) => ({
		...one,
		near: c.words.filter((other) => other.word !== one.word),
	}));

if (flags.export) {
	writeFileSync(
		flags.export,
		`${JSON.stringify(
			{
				guide: GUIDE,
				cases: cases.map((c) => ({ name: c.name, words: questionsOf(c) })),
			},
			null,
			"\t",
		)}\n`,
	);
	console.log(`写出 ${cases.length} 个用例到 ${flags.export}`);
	process.exit(0);
}

/** 外部判定方的回答，按用例和词排回提问的顺序；没回答的词是 undefined，计为漏答。 */
function answersFrom(file: string): (unknown | undefined)[][] {
	const data: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (!Array.isArray(data))
		throw new Error(`${file}：应是 [{ name, judgments }] 数组`);
	const byName = new Map<string, Map<string, unknown>>();
	for (const item of data) {
		if (typeof item?.name !== "string" || !Array.isArray(item.judgments))
			continue;
		const byWord = new Map<string, unknown>();
		for (const judgment of item.judgments)
			if (typeof judgment?.word === "string")
				byWord.set(judgment.word, judgment);
		byName.set(item.name, byWord);
	}
	return cases.map((c) =>
		c.words.map((one) => byName.get(c.name)?.get(one.word)),
	);
}

/** 自带模型的回答：全部用例的词一次问完，再按用例切回去。 */
async function answersFromModel(): Promise<(unknown | undefined)[][]> {
	const questions = cases.map(questionsOf);
	const payloads = await askModel(questions.flat(), (line) =>
		console.error(line),
	);
	const starts = questions.map((_, index) =>
		questions.slice(0, index).reduce((sum, one) => sum + one.length, 0),
	);
	return questions.map((one, index) => {
		const start = starts[index] ?? 0;
		return payloads.slice(start, start + one.length);
	});
}

/** 招聘的人不会点的归属名：太长，或者是「……能力」「……相关」这种概括。 */
const UNCLICKABLE = /(能力|相关|工作|事务|方面|类$|等$)/;

/**
 * 在筛选栏点 `query` 会不会带出写了 `word` 的人：同一个标准词的写法和它下面一层层的
 * 细词都带出来，往上不带。
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
let kept = 0;
let dropped = 0;
let unclickable = 0;
const names = new Set<string>();
let failed = 0;
try {
	const answers = flags.answers
		? answersFrom(flags.answers)
		: await answersFromModel();
	for (const [index, c] of cases.entries()) {
		const problems: string[] = [];
		const table: Table = new Map();
		const unanswered: string[] = [];
		for (const [at, question] of questionsOf(c).entries()) {
			const verdict = conform(
				answers[index]?.[at],
				question.word,
				question.near.map((one) => one.word),
			);
			if (verdict) place(table, question, verdict, new Date());
			else unanswered.push(question.word);
		}
		if (unanswered.length) problems.push(`漏答 ${unanswered.join("、")}`);
		const lost = c.found.filter(([q, w]) => !carries(table, q, w));
		found += c.found.length;
		missed += lost.length;
		if (lost.length)
			problems.push(
				`漏人 ${lost.map(([q, w]) => `点${q}不带${w}`).join("、")}`,
			);
		const wrong = c.notFound.filter(([q, w]) => carries(table, q, w));
		notFound += c.notFound.length;
		mixed += wrong.length;
		if (wrong.length)
			problems.push(
				`混人 ${wrong.map(([q, w]) => `点${q}带出${w}`).join("、")}`,
			);
		const gone = c.words
			.map((one) => one.word)
			.filter((word) => table.get(word)?.excluded);
		const stayed = c.excluded.filter((word) => !gone.includes(word));
		kept += stayed.length;
		if (stayed.length) problems.push(`没删掉 ${stayed.join("、")}`);
		const lostWords = gone.filter((word) => !c.excluded.includes(word));
		dropped += lostWords.length;
		if (lostWords.length) problems.push(`误删 ${lostWords.join("、")}`);
		const bad: string[] = [];
		for (const decision of table.values()) {
			const parent = decision.parent;
			if (parent === null) continue;
			names.add(parent);
			if ([...parent].length > 8 || UNCLICKABLE.test(parent)) bad.push(parent);
		}
		unclickable += bad.length;
		if (bad.length) problems.push(`归属名不像能力词 ${bad.join("、")}`);
		const said = c.words
			.map(({ word }) => {
				if (unanswered.includes(word)) return `${word}（漏答）`;
				const decision = table.get(word);
				if (decision?.excluded) return `${word}✗`;
				const canonical = decision?.canonical ?? word;
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
	const expected = cases.reduce((sum, c) => sum + c.excluded.length, 0);
	console.log(
		`\n混人 ${mixed}/${notFound}，漏人 ${missed}/${found}，没删掉 ${kept}/${expected}，误删 ${dropped}，` +
			`归属名不像能力词 ${unclickable}，起了 ${names.size} 个不同的归属名，` +
			`${failed} 个用例没过，共 ${cases.length} 个`,
	);
	if (failed > 0) process.exitCode = 1;
} finally {
	await pool.end();
}
