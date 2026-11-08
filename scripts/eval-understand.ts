/**
 * 查询理解验收：拿「当前条件 + 一句话」跑真模型，看新的条件表、说明和**搜出来的名单**对不对。
 *
 * 用法：bun run eval:understand            # 读 evals/understand/*.json
 *      bun run eval:understand 文件.json
 *
 * 用例文件是一个 JSON 数组，每项：
 *   { "name": "补充需求，去掉一条",
 *     "base": "推荐算法, +company:字节",   // 可选：当前条件，一行查询语法（search/query-syntax.ts），编译成查询
 *     "say": "不用非得是字节",          // 这一句话
 *     "drop": "+company:字节",             // 可选：新表里必须没有的条件，一行查询语法
 *     "has": "education:>=本科",       // 可选：新表里必须有一条同强度、选中同样的段或人的条件
 *     "add": ["+团队"],                // 可选：新加的条件里必须提到的词，前缀 + / - 是加分 / 排除
 *     "tells": true,                   // 可选：必须对 HR 说一句话（有搜不了的要求）
 *     "asks": true,                    // 可选：必须给出可以换成的理解（一个词有几种意思）
 *     "offer": ["iOS"],                // 可选：某个选项新加的条件里必须提到的词
 *     "quiet": true,                   // 可选：不该对 HR 说任何话
 *     "together": [["字节", "算法"]],  // 可选：每组词写在同一条新条件里（同一段经历）
 *     "apart": [["字节", "算法"]],     // 可选：每组词分写在不同的新条件里（只要求同一个人）
 *     "empty": true,                   // 可选：新表必须是空的
 *     "rewrite": true,                 // 可选：这句话换了一件事，不要求保留 base
 *     "includes": ["E1026"],           // 可选：名单上必须有的工号
 *     "excludes": ["E1029"],           // 可选：名单上不能有的工号
 *     "before": [["E1027", "E1026"]],  // 可选：前一个人排在后一个人前面
 *     "evidence": { "E1026": { "months": 12, "place": "甲辰科技" } } }
 *                                      // 可选：这个人第一条主张的累计月数；每一行证据都在这个地方
 *
 * 没有 rewrite 的题，base 里除了 drop 的每一条都必须原样留在新表里（同一个 id、同样的内容）——
 * 模型不能顺手丢掉或改掉用户没提到的条件。词比对折叠全半角、大小写和空白，按包含算，
 * 比的是条件拿来搜的字（语义词、文字参数、where 里的文字取值）：模型写「团队管理」也算提到了「团队」。
 *
 * 名单这一半（has、includes、excludes、before、evidence）按搜索的真实执行打分：模型写的 SQL
 * 搜出谁、证据是哪几段、累计多久，和工作台同一条路（`search/execute.ts`）。标签只是写给 HR
 * 的话，不当作已验证的解释；名单对了才算对。这一半要在有对应数据的库上跑：§10 的原型样例
 * 用合成样例同步出的库（`TALENT_SOURCE=csv-dir`，样例目录 `src/corpus/sources/sample`）。
 *
 * 设了 `EVAL_SHOW_SQL=1` 时每题下面列出每条的 FROM、语义词、where 和参数，给人对照标签读。
 *
 * 一题只要有一处不对就打叉，退出码看的是有没有打叉的题。模型写的说明原样显示在界面上，
 * 里面出现内部用词（`lib/internal-words.ts`）也算一处不对；那句话要书面简洁：一句话、
 * 不带括号，说明和选项带括号也算。
 *
 * 调用与工作台相同的入口（`server/llm.ts` 的 `understand`，评的是提交检查录取、会写进记录
 * 的那份），用当前配置的端点和模型；词表和记录流从当前库里取，和线上发给模型的是同一份。
 * 合成用例进仓库（sample.json）；真实的找人问题不进版本库。
 */

import "@tanstack/react-start/server-only";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pool } from "#/db";
import { internalWordsIn } from "#/lib/internal-words";
import { compileConditions } from "#/search/compile";
import { execute, selection } from "#/search/execute";
import { unanswered } from "#/search/intent";
import {
	contentKey,
	labelsInSentence,
	type QueryCondition,
	termValues,
} from "#/search/query";
import { parseQuery } from "#/search/query-syntax";
import { vocabulary } from "#/search/search";
import { changesOf } from "#/search/spec";
import { RESULT_MAX } from "#/search/weights";
import { agentToolsWithoutTrace } from "#/server/agent-tools";
import { streamFacts } from "#/server/discover";
import { understand } from "#/server/llm";

type Mode = QueryCondition["mode"];

type Case = {
	name: string;
	base: QueryCondition[];
	say: string;
	drop: QueryCondition[];
	has: QueryCondition[];
	add: { mode: Mode; word: string }[];
	tells: boolean;
	asks: boolean;
	offer: string[];
	quiet: boolean;
	together: string[][];
	apart: string[][];
	empty: boolean;
	rewrite: boolean;
	includes: string[];
	excludes: string[];
	before: [string, string][];
	evidence: Record<string, { months?: number; place?: string }>;
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
			return compileConditions(parsed).conditions;
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
		const groups = (key: string, size?: number) => {
			const value = c[key] ?? [];
			if (
				!Array.isArray(value) ||
				!value.every(
					(g) =>
						strings(g) &&
						(size === undefined ? g.length > 1 : g.length === size),
				)
			)
				throw new Error(
					`${where}：${key} 只能是字符串数组的数组，每组${size ? ` ${size} 个` : "至少两个"}词`,
				);
			return value as string[][];
		};
		const evidence = (c.evidence ?? {}) as Case["evidence"];
		if (typeof evidence !== "object" || Array.isArray(evidence))
			throw new Error(`${where}：evidence 是工号到 { months, place } 的对象`);
		const parsed: Case = {
			name: c.name.trim(),
			base: syntax("base"),
			say: c.say.trim(),
			drop: syntax("drop"),
			has: syntax("has"),
			add,
			tells: c.tells === true,
			asks: c.asks === true,
			offer: list("offer"),
			quiet: c.quiet === true,
			together: groups("together"),
			apart: groups("apart"),
			empty: c.empty === true,
			rewrite: c.rewrite === true,
			includes: list("includes"),
			excludes: list("excludes"),
			before: groups("before", 2) as [string, string][],
			evidence,
		};
		const checks = [
			parsed.add.length,
			parsed.tells,
			parsed.asks,
			parsed.offer.length,
			parsed.quiet,
			parsed.drop.length,
			parsed.has.length,
			parsed.empty,
			parsed.includes.length,
			parsed.excludes.length,
			parsed.before.length,
			Object.keys(parsed.evidence).length,
		];
		if (!checks.some(Boolean))
			throw new Error(
				`${where}：至少要有 add、drop、has、tells、asks、offer、quiet、empty、includes、excludes、before、evidence 之一`,
			);
		return parsed;
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

/**
 * 一条条件拿来搜的字：语义词、文字参数和 where 里直接写的文字取值。标签不算：它只是写给 HR
 * 的话，「不要求做算法」里有「算法」，搜的却不是算法。
 */
function wordsOf(c: QueryCondition): string[] {
	return [
		...termValues(c),
		...Object.values(c.params ?? {}).filter(
			(v): v is string => typeof v === "string",
		),
		...[...c.where.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1] ?? ""),
	];
}
const mentions = (c: QueryCondition, word: string) =>
	wordsOf(c).some((w) => norm(w).includes(norm(word)));

/**
 * 一条条件的身份，用来比两条条件是不是同一个要求：经历条件比选中的段，人的条件比满足的人；
 * 强度不改写，排除按排除的门槛比它实际否决的段。跑不了的条件抛出原因。
 */
async function selectedBy(c: QueryCondition): Promise<string> {
	const [one] = await selection({ conditions: [c] });
	if (!one?.selected) throw new Error(one?.problem ?? "这条条件没有跑");
	return one.selected.join(",");
}

let failed = 0;
try {
	const facts = { vocab: await vocabulary(), streams: await streamFacts() };
	for (const c of cases) {
		const problems: string[] = [];
		let summary = "";
		try {
			const { submitted, admitted: result } = await understand(
				c.say,
				facts,
				c.base,
				agentToolsWithoutTrace(c.base),
			);
			const failure = unanswered(submitted, result);
			if (failure) problems.push(failure);
			const next = result.query.conditions;
			const sameAs = (a: QueryCondition) => (b: QueryCondition) =>
				contentKey(a) === contentKey(b);

			if (!c.rewrite)
				for (const kept of c.base)
					if (
						!c.drop.some(sameAs(kept)) &&
						!next.some((n) => n.id === kept.id && sameAs(kept)(n))
					)
						problems.push(`没保住「${kept.label}」`);
			for (const gone of c.drop)
				if (next.some(sameAs(gone))) problems.push(`没去掉「${gone.label}」`);
			for (const want of c.has) {
				const target = await selectedBy(want);
				const peers = next.filter(
					(n) => n.mode === want.mode && n.from === want.from,
				);
				let found = false;
				for (const n of peers)
					if ((await selectedBy(n).catch(() => null)) === target) {
						found = true;
						break;
					}
				if (!found)
					problems.push(`没有一条和「${want.label}」选中同样的段或人`);
			}

			const { added } = changesOf(c.base, next);
			for (const { mode, word } of c.add)
				if (!added.some((one) => one.mode === mode && mentions(one, word)))
					problems.push(`没加上「${word}」（${mode}）`);
			for (const group of c.together)
				if (!added.some((one) => group.every((word) => mentions(one, word))))
					problems.push(`「${group.join("」「")}」没写在同一条里`);
			for (const group of c.apart)
				if (
					added.some(
						(one) => group.filter((word) => mentions(one, word)).length > 1,
					)
				)
					problems.push(`「${group.join("」「")}」不该写在同一条里`);

			const notes = result.notes;
			const others = notes?.choices?.others ?? [];
			if ((c.tells || c.asks) && !notes) problems.push("没对 HR 说那句话");
			if (c.asks && others.length === 0) problems.push("没给可以换成的理解");
			if (c.quiet && notes) problems.push(`不该说话：${notes.says}`);
			const offered = others.flatMap(
				(o) => changesOf(next, o.conditions).added,
			);
			for (const word of c.offer)
				if (!offered.some((one) => mentions(one, word)))
					problems.push(`选项里没有「${word}」`);
			if (c.empty && next.length > 0) problems.push("条件表应当是空的");
			// 那句话、选项和每条标签原样显示给 HR：不能带代码和模型那一侧的词，要书面简洁
			const shown = notes
				? [
						notes.says,
						...(notes.choices ? [notes.choices.current] : []),
						...others.flatMap((o) => [
							o.label,
							...(o.detail ? [o.detail] : []),
						]),
					]
				: [];
			for (const line of [...shown, ...next.map((n) => n.label)]) {
				const leaked = internalWordsIn(line);
				if (leaked.length > 0)
					problems.push(
						`给 HR 看的话里有内部用词「${leaked.join("、")}」：${line}`,
					);
			}
			for (const line of shown)
				if (/[（）()[\]【】]/.test(line)) problems.push(`说明带括号：${line}`);
			if (notes && /[。！？!?].+/.test(notes.says))
				problems.push(`那句话不止一句：${notes.says}`);

			const listed =
				c.includes.length +
					c.excludes.length +
					c.before.length +
					Object.keys(c.evidence).length >
				0;
			let roster = "";
			if (listed) {
				const outcome = await execute({ conditions: next }, {}, RESULT_MAX);
				const order = outcome.results.map((r) => r.employee.empId);
				roster = `名单 ${outcome.total} 人：${order.slice(0, 12).join(" ")}${order.length > 12 ? " …" : ""}`;
				for (const id of c.includes)
					if (!order.includes(id)) problems.push(`名单上没有 ${id}`);
				for (const id of c.excludes)
					if (order.includes(id)) problems.push(`名单上不该有 ${id}`);
				for (const [a, b] of c.before) {
					const [i, j] = [order.indexOf(a), order.indexOf(b)];
					if (i < 0 || j < 0 || i > j) problems.push(`${a} 没排在 ${b} 前面`);
				}
				for (const [id, want] of Object.entries(c.evidence)) {
					const row =
						outcome.order === "evidence"
							? outcome.results.find((r) => r.employee.empId === id)
							: undefined;
					if (!row) {
						problems.push(`${id} 没有证据行`);
						continue;
					}
					const months = row.basis.find((b) => b !== null)?.months;
					if (want.months !== undefined && months !== want.months)
						problems.push(
							`${id} 的累计是 ${months ?? "?"} 个月，应是 ${want.months}`,
						);
					const place = want.place;
					if (place) {
						const elsewhere = row.hits.filter(
							(h) => !(h.company || h.department).includes(place),
						);
						if (elsewhere.length > 0)
							problems.push(
								`${id} 的证据有不在${place}的：${[...new Set(elsewhere.map((h) => h.company || h.department))].join("、")}`,
							);
					}
				}
			}

			summary = [
				labelsInSentence(next) || "（空）",
				...(notes ? [`说：${notes.says}`] : []),
				...(notes?.choices ? [`现在：${notes.choices.current}`] : []),
				...others.map(
					(o) =>
						`可选：${o.label}——${o.detail ?? ""}（${labelsInSentence(changesOf(next, o.conditions).added) || "只去掉条件"}）`,
				),
				...(roster ? [roster] : []),
			].join(" | ");
			if (process.env.EVAL_SHOW_SQL)
				summary += next
					.map(
						(n) =>
							`\n     ${n.label}：${n.from} ${JSON.stringify(n.terms ?? {})} where ${n.where} ${JSON.stringify(n.params ?? {})}${n.minMonths ? ` ≥${n.minMonths}月` : ""}`,
					)
					.join("");
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
