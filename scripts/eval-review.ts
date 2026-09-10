/**
 * 整理质量验收：拿已知答案的一组组能力词让裁判模型判，报合并与归属的对错。
 *
 * 用法：bun run eval:review            # 读 evals/review/*.json
 *      bun run eval:review 文件.json
 *
 * 用例文件是一个 JSON 数组，每项是一道题：
 *   { "name": "数据分析",
 *     "words": [{ "word": "数据分析", "people": 40 }, { "word": "销售数据分析", "people": 6 }, …],
 *     "same": [["数据分析", "数据分析能力"]],              // 必须判成同一件事的词
 *     "apart": [["销售数据分析", "数据分析"]],             // 绝不能并到一起的词对（宽细、兄弟、邻居）
 *     "parent": { "销售数据分析": ["数据分析"], "数据统计": [""] } }  // 可接受的归属，"" 是「没有归属」
 *
 * 量四样：same 里的词对有没有并上（召回）；apart 里的词对有没有被并（**有损合并**，这是不可逆的
 * 那种错，一条都不该有）；parent 里每个词的归属在不在可接受的集合里；起出来的归属名是不是能力词
 * 的写法（超 8 字、带「能力」「相关」「工作」的都不是招聘的人会点的）。收窄和整理时同一份（`conform`）：
 * 方向反了的归属在那里已经拦下，这里看到的就是会写进表的东西。
 *
 * 合成用例进仓库（sample.json）；真实组是库里圈出来的词，不进版本库。走的是整理答题同一条路
 * （`corpus/vocabulary.ts` 的 `askModel`）：当前提示词、`REVIEW_MODEL`、温度 0，回答进同一份缓存。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { askModel, conform, type Member } from "#/corpus/vocabulary";
import { pool } from "#/db";

type Case = {
	name: string;
	words: Member[];
	same: string[][];
	apart: [string, string][];
	parent: Record<string, string[]>;
};

const strings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((x) => typeof x === "string");

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
		const known = new Set((words as Member[]).map((m) => m.word));
		const same = c.same ?? [];
		const apart = c.apart ?? [];
		const parent = c.parent ?? {};
		if (!Array.isArray(same) || !same.every(strings))
			throw new Error(`${where}「${c.name}」：same 是「一组组词」的数组`);
		if (
			!Array.isArray(apart) ||
			!apart.every((p) => strings(p) && p.length === 2)
		)
			throw new Error(`${where}「${c.name}」：apart 是词对的数组`);
		if (
			typeof parent !== "object" ||
			parent === null ||
			!Object.values(parent).every(strings)
		)
			throw new Error(`${where}「${c.name}」：parent 是「词 → 可接受的归属」`);
		for (const word of [
			...(same as string[][]).flat(),
			...(apart as string[][]).flat(),
			...Object.keys(parent),
		])
			if (!known.has(word))
				throw new Error(
					`${where}「${c.name}」：答案里的「${word}」不在 words 里`,
				);
		if ((same as string[][]).length === 0 && Object.keys(parent).length === 0)
			throw new Error(`${where}「${c.name}」：没有答案的题什么都量不出来`);
		return {
			name: c.name,
			words: words as Member[],
			same: same as string[][],
			apart: apart as [string, string][],
			parent: parent as Record<string, string[]>,
		};
	});
}

const args = process.argv.slice(2);
const dir = join("evals", "review");
const files =
	args.length > 0
		? args
		: readdirSync(dir)
				.filter((f) => f.endsWith(".json"))
				.map((f) => join(dir, f));
if (files.length === 0) throw new Error(`${dir} 下没有用例文件`);
const cases = files.flatMap(loadCases);

/** sameAs 连成的片：无向、传递，和记账时同一种算法。 */
function classes(words: string[], sameAs: Map<string, string | null>) {
	const root = new Map(words.map((w) => [w, w]));
	const find = (w: string): string => {
		let at = w;
		while (root.get(at) !== at) at = root.get(at) as string;
		return at;
	};
	for (const [word, other] of sameAs)
		if (other !== null && root.has(other)) root.set(find(word), find(other));
	return new Map(words.map((w) => [w, find(w)]));
}

const pair = (a: string, b: string) => [a, b].sort().join("=");
/** 招聘的人不会点的归属名：太长，或者是「……能力」「……相关」这种概括。 */
const UNCLICKABLE = /(能力|相关|工作|事务|方面|类$|等$)/;

let samePairs = 0;
let sameHit = 0;
let lossy = 0;
let parents = 0;
let parentOk = 0;
let unclickable = 0;
const names = new Set<string>();
try {
	const payloads = await askModel(
		cases.map((c) => c.words),
		(line) => console.error(line),
	);
	for (const [index, c] of cases.entries()) {
		const words = c.words.map((m) => m.word);
		const verdicts = conform(payloads[index], words);
		const problems: string[] = [];
		if (payloads[index] === undefined) problems.push("没有得到合法 JSON");
		const cls = classes(
			words,
			new Map(words.map((w) => [w, verdicts.get(w)?.sameAs ?? null])),
		);
		const merged = new Set<string>();
		for (const a of words)
			for (const b of words)
				if (a < b && cls.get(a) === cls.get(b)) merged.add(pair(a, b));
		const wanted = new Set<string>();
		for (const group of c.same)
			for (const a of group)
				for (const b of group) if (a < b) wanted.add(pair(a, b));
		samePairs += wanted.size;
		const missed = [...wanted].filter((p) => !merged.has(p));
		sameHit += wanted.size - missed.length;
		if (missed.length) problems.push(`没并上 ${missed.join("、")}`);
		const broken = c.apart.filter(([a, b]) => merged.has(pair(a, b)));
		lossy += broken.length;
		if (broken.length)
			problems.push(
				`有损合并 ${broken.map(([a, b]) => `${a}=${b}`).join("、")}`,
			);
		const wrong: string[] = [];
		for (const [word, accepted] of Object.entries(c.parent)) {
			const parent = verdicts.get(word)?.parent ?? "";
			parents++;
			if (accepted.includes(parent)) parentOk++;
			else wrong.push(`${word}→${parent || "∅"}`);
		}
		if (wrong.length) problems.push(`归属不对 ${wrong.join("、")}`);
		const bad: string[] = [];
		for (const verdict of verdicts.values()) {
			const parent = verdict.parent;
			if (parent === null) continue;
			names.add(parent);
			if ([...parent].length > 8 || UNCLICKABLE.test(parent)) bad.push(parent);
		}
		unclickable += bad.length;
		if (bad.length) problems.push(`归属名不像能力词 ${bad.join("、")}`);
		const said = words
			.map((w) => {
				const v = verdicts.get(w);
				const tags = [
					v?.sameAs ? `=${v.sameAs}` : "",
					v?.parent ? `∈${v.parent}` : "",
				].join("");
				return tags ? `${w}${tags}` : w;
			})
			.join(" | ");
		console.log(`${problems.length ? "✗" : "✓"} ${c.name}  ${said}`);
		if (problems.length) console.log(`   ${problems.join("；")}`);
	}
	console.log(
		`\n合并召回 ${sameHit}/${samePairs}，有损合并 ${lossy}，归属正确 ${parentOk}/${parents}，` +
			`归属名不像能力词 ${unclickable}，起了 ${names.size} 个不同的归属名，共 ${cases.length} 题`,
	);
	if (
		sameHit !== samePairs ||
		lossy > 0 ||
		parentOk !== parents ||
		unclickable > 0
	)
		process.exitCode = 1;
} finally {
	await pool.end();
}
