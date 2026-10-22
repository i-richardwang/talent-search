/**
 * 抽取质量验收：拿已知答案的简历段跑真抽取，报召回、精确和投入档。
 *
 * 用法：bun run eval:extract            # 读 evals/extract/*.json
 *      bun run eval:extract 文件.json
 *
 * 用例文件是一个 JSON 数组，每项：
 *   { "name": "A1：Java开发工程师",
 *     "title": "Java开发工程师", "company": "某科技", "description": "负责……",
 *     "gold": [{ "words": ["接口开发", "API 开发"], "depth": "做过" }],
 *     "ok": ["后端开发"],        // 可选：写了不算错、没写也不算漏的写法
 *     "keep": ["售后"],          // 可选：这段必须保住的限定语，出现在任一个词里即算保住
 *     "reject": ["华为"] }       // 可选：不该出现的字样（项目名、公司名）
 *
 * 好的标准：每一项都是 HR 会拿来找人的能力（「找做过___的人」「找会___的人」），写到能区分
 * 业务的那一档，不带场景、公司、产品、活动名，不是目标、指标、日常材料或泛泛的动作；档看原文
 * 里直接说这一项的那句话。金标按这个标准写：`words` 是一组可接受的写法，抽出任一种算命中；
 * `depth` 是这一项的档，两档都说得通时写「主导|做过」，判成任一个都算对，隔一档
 * （主导与提到互换）是严重错。抽出的词对不上任何一项、也不在 `ok` 里，算多写。
 *
 * 没有 gold 的段只检查形状——动作尾（「……搭建」）、超 8 字——这些不用答案也看得出提示词
 * 是不是有偏差。一段只要有一处不对就打叉，退出码看的是有没有打叉的段：屏幕上的叉和退出码
 * 是同一个判断。合成用例进仓库（sample.json，干净克隆也能跑通）；真实段是真人的简历原文，
 * 不进版本库。各文件分别汇总：合成段偏短偏整齐，和真实段的数字不能相加着看。
 *
 * 调用与解析相同的入口（`corpus/extract.ts` 的 `extract`）：当前提示词、当前模型、温度 0，回答进
 * 同一份缓存。同一段、同一提示词、同一模型不会再问端点；改了提示词会重新请求。所以这个验收衡量的是
 * 「此刻配置下的抽取」，换模型也用它。
 */

import "@tanstack/react-start/server-only";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extract } from "#/corpus/extract";
import { pool } from "#/db";
import { ENGAGEMENTS, type Engagement, isEngagement } from "#/lib/engagement";

type Gold = { words: string[]; depth: Engagement[] | null };

type Case = {
	file: string;
	name: string;
	title: string;
	company: string;
	description: string;
	gold: Gold[] | null;
	ok: string[];
	keep: string[];
	reject: string[];
};

const strings = (value: unknown): value is string[] =>
	Array.isArray(value) &&
	value.every((x) => typeof x === "string" && Boolean(x.trim()));

function goldItem(raw: unknown, where: string): Gold {
	const g = (raw ?? {}) as Record<string, unknown>;
	if (!strings(g.words) || g.words.length === 0)
		throw new Error(`${where}：gold 每项的 words 是非空的写法数组`);
	if (g.depth === undefined) return { words: g.words, depth: null };
	const depth = typeof g.depth === "string" ? g.depth.split("|") : [];
	if (depth.length === 0 || !depth.every(isEngagement))
		throw new Error(
			`${where}：depth 是 ${ENGAGEMENTS.join("、")} 之一，两档都对写成「主导|做过」`,
		);
	return { words: g.words, depth };
}

function loadCases(file: string): Case[] {
	const data: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (!Array.isArray(data) || data.length === 0)
		throw new Error(`${file}：应是一个非空 JSON 数组，格式见文件头注释`);
	return data.map((raw, i) => {
		const c = (raw ?? {}) as Record<string, unknown>;
		const where = `${file} 第 ${i + 1} 段`;
		for (const key of ["name", "title", "company", "description"])
			if (typeof c[key] !== "string" || !(c[key] as string).trim())
				throw new Error(`${where}：${key} 必须是非空字符串`);
		const gold = c.gold ?? null;
		if (gold !== null && !Array.isArray(gold))
			throw new Error(`${where}：gold 是一项项金标的数组`);
		if (gold !== null && gold.length === 0)
			throw new Error(
				`${where}：gold 为空就无法衡量；不知道答案就不要写这个字段`,
			);
		const ok = c.ok ?? [];
		const keep = c.keep ?? [];
		const reject = c.reject ?? [];
		if (!strings(ok) || !strings(keep) || !strings(reject))
			throw new Error(`${where}：ok、keep 与 reject 只能是字符串数组`);
		return {
			file,
			name: c.name as string,
			title: c.title as string,
			company: c.company as string,
			description: c.description as string,
			gold:
				gold?.map((g, j) => goldItem(g, `${where} gold 第 ${j + 1} 项`)) ??
				null,
			ok,
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
const same = (words: string[], word: string) =>
	words.some((w) => norm(w) === norm(word));
const ACTION_TAIL = /(建设|搭建|制定|推动|落地|推进|改善|提升|开展)$/;

type Tally = {
	cases: number;
	failed: number;
	goldItems: number;
	hit: number;
	written: number;
	fine: number;
	judged: number;
	right: number;
	far: number;
	keeps: number;
	kept: number;
	rejected: number;
	tails: number;
	over8: number;
	depths: Record<string, number>;
};

const tally = (): Tally => ({
	cases: 0,
	failed: 0,
	goldItems: 0,
	hit: 0,
	written: 0,
	fine: 0,
	judged: 0,
	right: 0,
	far: 0,
	keeps: 0,
	kept: 0,
	rejected: 0,
	tails: 0,
	over8: 0,
	depths: {},
});

const pct = (a: number, b: number) =>
	b ? `${Math.round((a / b) * 100)}%` : "—";

function summary(label: string, t: Tally) {
	const depths = [...ENGAGEMENTS, "未判断"]
		.filter((d) => t.depths[d])
		.map((d) => `${d} ${t.depths[d]}`)
		.join("、");
	const scored = t.goldItems
		? `召回 ${t.hit}/${t.goldItems}（${pct(t.hit, t.goldItems)}），精确 ${t.fine}/${t.written}（${pct(t.fine, t.written)}），` +
			`档判对 ${t.right}/${t.judged}（${pct(t.right, t.judged)}），隔档 ${t.far}，`
		: "";
	return (
		`${label}：${scored}限定语保住 ${t.kept}/${t.keeps}，不该出现 ${t.rejected}，` +
		`动作尾 ${t.tails}，超 8 字 ${t.over8}；档分布 ${depths || "—"}；${t.failed} 段没过，共 ${t.cases} 段`
	);
}

const totals = new Map(files.map((f) => [f, tally()]));
try {
	const extractions = await extract(
		cases.map((c) => ({
			kind: "external",
			unemployed: false,
			title: c.title,
			company: c.company,
			description: c.description,
		})),
		(line) => console.error(line),
	);
	for (const [index, c] of cases.entries()) {
		const t = totals.get(c.file) as Tally;
		t.cases++;
		const result = extractions[index];
		const items = result?.status === "done" ? result.value.items : [];
		const problems: string[] = [];
		if (result?.status !== "done") problems.push("没有得到合法 JSON");
		for (const item of items) {
			const d = item.engagement ?? "未判断";
			t.depths[d] = (t.depths[d] ?? 0) + 1;
		}
		let recall = "";
		if (c.gold) {
			const gold = c.gold;
			const missed = gold.filter(
				(g) => !items.some((i) => same(g.words, i.text)),
			);
			const extra = items.filter(
				(i) => !gold.some((g) => same(g.words, i.text)) && !same(c.ok, i.text),
			);
			t.goldItems += gold.length;
			t.hit += gold.length - missed.length;
			t.written += items.length;
			t.fine += items.length - extra.length;
			recall = `  召回 ${gold.length - missed.length}/${gold.length}`;
			if (missed.length)
				problems.push(`漏了 ${missed.map((g) => g.words[0]).join("、")}`);
			if (extra.length)
				problems.push(`多写 ${extra.map((i) => i.text).join("、")}`);
			for (const g of gold) {
				const found = items.find((i) => same(g.words, i.text));
				if (!found || !g.depth) continue;
				t.judged++;
				if (found.engagement && g.depth.includes(found.engagement)) {
					t.right++;
					continue;
				}
				const far =
					found.engagement === null ||
					g.depth.every(
						(d) =>
							Math.abs(
								ENGAGEMENTS.indexOf(d) -
									ENGAGEMENTS.indexOf(found.engagement as Engagement),
							) >= 2,
					);
				if (far) t.far++;
				problems.push(
					`${g.words[0]} 应是${g.depth.join("或")}，判成${found.engagement ?? "未判断"}${far ? "（隔档）" : ""}`,
				);
			}
		}
		const words = items.map((i) => i.text);
		const lost = c.keep.filter((q) => !words.some((w) => w.includes(q)));
		t.keeps += c.keep.length;
		t.kept += c.keep.length - lost.length;
		if (lost.length) problems.push(`丢了限定语 ${lost.join("、")}`);
		const leaks = words.filter((w) => c.reject.some((r) => w.includes(r)));
		t.rejected += leaks.length;
		if (leaks.length) problems.push(`不该出现 ${leaks.join("、")}`);
		const tailed = words.filter((w) => ACTION_TAIL.test(w));
		const long = words.filter((w) => [...w].length > 8);
		t.tails += tailed.length;
		t.over8 += long.length;
		if (tailed.length) problems.push(`动作尾 ${tailed.join("、")}`);
		if (long.length) problems.push(`超 8 字 ${long.join("、")}`);
		console.log(
			`${problems.length ? "✗" : "✓"} ${c.name}${recall}  ${items
				.map((i) => `${i.text}/${i.engagement ?? "?"}`)
				.join(" | ")}`,
		);
		if (problems.length) {
			t.failed++;
			console.log(`   ${problems.join("；")}`);
		}
	}
	console.log("");
	for (const [file, t] of totals) console.log(summary(file, t));
	if ([...totals.values()].some((t) => t.failed > 0)) process.exitCode = 1;
} finally {
	await pool.end();
}
