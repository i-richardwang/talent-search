/** 经历匹配度盲评。两份名单使用同一批已确认的人和经历，比较匹配分对排序的影响。 */
import { randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ENGAGEMENTS } from "#/lib/engagement";
import type { Claim } from "#/search/query";
import { type Fact, order } from "#/search/rank";

const line = z
	.string()
	.trim()
	.min(1)
	.regex(/^[^\r\n]+$/);
const input = z.object({
	source: line,
	asOf: z.iso.date(),
	groups: z
		.array(
			z.object({
				queries: z.array(z.object({ label: line, criterion: line })).min(1),
				segments: z
					.array(
						z.object({
							person: line,
							text: z.string().trim().min(1),
							months: z.int().positive(),
							end: z.iso.date().nullable(),
							route: z.enum(["role", "title", "description", "skill"]),
							engagement: z.enum(ENGAGEMENTS).nullish(),
						}),
					)
					.min(1),
			}),
		)
		.min(1),
});
type Segment = z.infer<typeof input>["groups"][number]["segments"][number];
const requirement = z.object({
	label: line,
	criterion: line,
	patterns: z.array(line),
	where: line,
	params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
const liveInput = z.object({
	source: line,
	tasks: z
		.array(z.object({ label: line, requirements: z.array(requirement).min(1) }))
		.min(1),
});
type JudgedClaim = Claim & { seek: { criterion: string } };
type Trial = {
	label: string;
	claims: JudgedClaim[];
	facts: Fact[];
	texts: Map<number, string>;
	population: number;
};
type Decision = {
	label: string;
	criterion: string;
	seen: number;
	fits: number[];
	scores: Record<number, number>;
};
type Comparison = {
	id: string;
	label: string;
	baseline: string[];
	graded: string[];
	population: number;
	sampled: number;
	poolSize: number;
	decisions: Decision[];
	people: Record<string, number[]>; // 盲评编号对应的证据段，用来复核匹配分。
};

function fact(s: Segment, id: number): Fact {
	return {
		id,
		personId: s.person,
		months: s.months,
		endDate: s.end,
		kind: s.route === "role" ? "internal" : "external",
		route: s.route,
		engagement: s.engagement ?? null,
		phrase: null,
		claim: 0,
		matchScore: null,
		seqL1: null,
		seqL2: null,
		companyTag: null,
		mainIndustries: [],
		skills: [],
		level: "",
		levelRank: null,
		recruitment: "",
		education: "",
		educationRank: null,
		schoolTier: "",
		overseas: null,
	};
}

function shuffled<T>(items: readonly T[]) {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
}

function claim(
	q: {
		label: string;
		criterion: string;
		patterns?: string[];
		where?: string;
		params?: Record<string, string | number>;
	},
	i: number,
): JudgedClaim {
	return {
		id: `c${i}`,
		label: q.label,
		mode: "must",
		from: "experience",
		where: q.where ?? "true",
		params: q.params,
		seek: { patterns: q.patterns ?? [], criterion: q.criterion },
	};
}

async function liveTrial(label: string, claims: JudgedClaim[]): Promise<Trial> {
	const { withSearchFacts } = await import("#/search/execute");
	const { readSegmentTexts } = await import("#/server/judged");
	const trial = await withSearchFacts(
		{ conditions: claims },
		null,
		async (store, { candidates, candidateFacts }) => {
			const people = candidates.map((r) => r.personId);
			// 保留字面名次前 20；从剩余名次等距抽至多 20 人，给有短经历的人进前十的机会。
			const rest = people.slice(20);
			const chosen = new Set(people.slice(0, 20));
			const count = Math.min(20, rest.length);
			for (let i = 0; i < count; i++)
				chosen.add(
					rest[Math.floor(((i + 0.5) * rest.length) / count)] as string,
				);
			const facts = candidateFacts.filter((f) => chosen.has(f.personId));
			const rows = await readSegmentTexts(store, [
				...new Set(facts.map((f) => f.id)),
			]);
			return {
				label,
				claims,
				facts,
				population: people.length,
				texts: new Map([...rows].map(([id, row]) => [id, row.text])),
			};
		},
	);
	if (!trial) throw new Error("实验查询无法执行或超过检索上限");
	return trial;
}

function textOf(trial: Trial, id: number) {
	const text = trial.texts.get(id);
	if (text === undefined) throw new Error("候选段缺少阅读原文");
	return text;
}

async function decide(
	trial: Trial,
	requirement: JudgedClaim,
	index: number,
	verdicts: Map<number, boolean>,
): Promise<Decision> {
	const { judgeSegments } = await import("#/server/llm");
	const { segmentBatches } = await import("#/server/segment-batches");
	const ids = shuffled([
		...new Set(trial.facts.filter((f) => f.claim === index).map((f) => f.id)),
	]);
	const {
		label,
		seek: { criterion },
	} = requirement;
	const input = ids
		.filter((id) => !verdicts.has(id))
		.map((id) => ({ id, text: textOf(trial, id) }));
	for (const { batch, entries } of segmentBatches(
		{ label, criterion },
		input,
	)) {
		const fits = new Set(await judgeSegments(batch));
		for (const [i, { id }] of entries.entries())
			verdicts.set(id, fits.has(i + 1));
	}
	return {
		label,
		criterion,
		seen: ids.length,
		fits: ids.filter((id) => verdicts.get(id)),
		scores: {},
	};
}

async function compare(trial: Trial, now: Date, id: string) {
	const decisions: Decision[] = [];
	const byCriterion = new Map<string, Map<number, boolean>>();
	for (const [i, c] of trial.claims.entries()) {
		const verdicts =
			byCriterion.get(c.seek.criterion) ?? new Map<number, boolean>();
		byCriterion.set(c.seek.criterion, verdicts);
		decisions.push(await decide(trial, c, i, verdicts));
	}
	const confirmed = decisions.map((d) => new Set(d.fits));
	const evidence = trial.facts.filter((f) => confirmed[f.claim]?.has(f.id));
	const baseline = order(evidence, evidence, trial.claims, {}, now).map(
		(r) => r.personId,
	);
	const { scoreTexts } = await import("#/server/scoring");
	const eligible = new Set(baseline);
	const inputs = evidence
		.filter((f) => eligible.has(f.personId))
		.map((f) => {
			const decision = decisions[f.claim];
			if (!decision) throw new Error("入围证据缺少所属判据");
			return { decision, id: f.id, text: textOf(trial, f.id) };
		});
	for (const [criterion, group] of Map.groupBy(
		inputs,
		(e) => e.decision.criterion,
	)) {
		await scoreTexts(
			criterion,
			Map.groupBy(group, (e) => e.text),
			(ratings) => {
				for (const { item, score } of ratings)
					for (const { decision, id } of item) decision.scores[id] = score;
			},
		);
	}
	const graded = order(
		evidence.map((f) => ({
			...f,
			matchScore: decisions[f.claim]?.scores[f.id] ?? null,
		})),
		evidence,
		trial.claims,
		{},
		now,
	).map((r) => r.personId);
	if (graded.length !== baseline.length || graded.some((p) => !eligible.has(p)))
		throw new Error("评分改变了入围名单");
	const pool = shuffled([
		...new Set([...baseline.slice(0, 10), ...graded.slice(0, 10)]),
	]);
	const aliases = new Map(
		pool.map((p, i) => [p, String(i + 1).padStart(2, "0")]),
	);
	const blind = [
		`## ${id}　${trial.label}`,
		"",
		...trial.claims.map((c) => `工作要求　${c.label}。 ${c.seek.criterion}`),
		"",
		`优先看 ${id}：`,
		"",
	];
	const people: Record<string, number[]> = {};
	for (const p of pool) {
		const code = aliases.get(p) as string;
		blind.push(`**候选 ${code}**`, "");
		const rows = evidence.filter((f) => f.personId === p);
		people[code] = [...new Set(rows.map((f) => f.id))];
		for (const segId of people[code]) {
			const f = rows.find((f) => f.id === segId) as Fact;
			blind.push(
				`> 任职段 ${f.months} 个月，${f.endDate ? `${f.endDate} 结束` : "仍在任"}`,
				...textOf(trial, segId)
					.split(/\r?\n/)
					.map((t) => `> ${t.trimEnd()}  `),
				"",
			);
		}
	}
	const encoded = (people: string[]) =>
		people.filter((p) => aliases.has(p)).map((p) => aliases.get(p) as string);
	const key: Comparison = {
		id,
		label: trial.label,
		baseline: encoded(baseline),
		graded: encoded(graded),
		population: trial.population,
		sampled: new Set(trial.facts.map((f) => f.personId)).size,
		poolSize: baseline.length,
		decisions,
		people,
	};
	return { blind, key };
}

async function prepare(file: string, parent: string, live: boolean) {
	const raw = JSON.parse(await readFile(file, "utf8"));
	const cases = live ? liveInput.parse(raw) : input.parse(raw);
	const asOf =
		"asOf" in cases ? cases.asOf : new Date().toLocaleDateString("sv-SE");
	const now = new Date(`${asOf}T12:00:00`);
	const token = randomUUID();
	const blind = [
		"# 人才搜索候选人盲评",
		"",
		`批次 ${token}`,
		"",
		`材料来源　${cases.source}。比较基准日 ${asOf}。`,
		"",
		"请按每题的工作要求，在「优先看」后填你最想先看的候选编号，最优先的写在前面，空格分隔。未选的人排在所选之后，彼此并列。判断没有差别填「无差别」，材料不足填「无法判断」。每题独立编号。",
		"",
	];
	const dir = join(parent, token);
	await mkdir(parent, { recursive: true });
	await mkdir(dir, { mode: 0o700 });
	const expected =
		"tasks" in cases
			? cases.tasks.length
			: cases.groups.reduce((n, g) => n + g.queries.length, 0);
	const keys: Comparison[] = [];
	async function add(trial: Trial) {
		const id = `Q${String(keys.length + 1).padStart(2, "0")}`;
		const { blind: card, key } = await compare(trial, now, id);
		keys.push(key);
		blind.push(...card);
		await writeFile(
			join(dir, "对照.json"),
			JSON.stringify(
				{
					token,
					expected,
					source: cases.source,
					asOf,
					model: process.env.LLM_MODEL,
					keys,
				},
				null,
				2,
			),
			{ mode: 0o600 },
		);
		await writeFile(join(dir, "盲评.md"), blind.join("\n"), { mode: 0o600 });
		const entering = key.graded
			.slice(0, 10)
			.filter((p) => !key.baseline.slice(0, 10).includes(p)).length;
		console.log(
			`${id}　字面候选 ${key.population}，抽样 ${key.sampled}，入围 ${key.poolSize}，前十更换 ${entering} 人`,
		);
	}
	if ("tasks" in cases) {
		for (const t of cases.tasks)
			await add(await liveTrial(t.label, t.requirements.map(claim)));
	} else {
		for (const group of cases.groups) {
			if (group.segments.some((s) => s.end && s.end > asOf))
				throw new Error("经历结束日晚于本批次基准日");
			const facts = group.segments.map((s, i) => fact(s, i + 1));
			for (const q of group.queries)
				await add({
					label: q.label,
					claims: [claim(q, 0)],
					facts,
					population: new Set(facts.map((f) => f.personId)).size,
					texts: new Map(group.segments.map((s, i) => [i + 1, s.text])),
				});
		}
	}
	console.log(dir);
}

async function score(dir: string, ballotFile: string) {
	const {
		token,
		keys,
		expected,
	}: { token: string; keys: Comparison[]; expected: number } = JSON.parse(
		await readFile(join(dir, "对照.json"), "utf8"),
	);
	if (keys.length !== expected)
		console.log(`批次目前完成 ${keys.length}/${expected} 题`);
	const ballot = await readFile(ballotFile, "utf8");
	if (!ballot.split(/\r?\n/).includes(`批次 ${token}`))
		throw new Error("盲评卷和对照不属于同一批");
	const answers = new Map<string, string>();
	for (const match of ballot.matchAll(/^优先看 (Q\d+)[：:]([^\r\n]*)$/gm)) {
		const id = match[1] as string;
		if (!keys.some((q) => q.id === id) || answers.has(id))
			throw new Error(`未知或重复的题号 ${id}`);
		answers.set(id, match[2]?.trim() ?? "");
	}
	let oldWins = 0,
		newWins = 0,
		tied = 0,
		skipped = 0,
		blank = 0,
		identical = 0;
	for (const q of keys) {
		const answer = answers.get(q.id);
		if (answer === undefined) throw new Error(`盲评卷缺题 ${q.id}`);
		const picks =
			!answer || answer === "无法判断" || answer === "无差别"
				? []
				: answer.split(/[、,，\s]+/).map((x) => x.padStart(2, "0"));
		if (
			new Set(picks).size !== picks.length ||
			picks.some((p) => !q.baseline.includes(p))
		)
			throw new Error(`${q.id} 有重复或无效编号`);
		if (q.baseline.every((person, i) => person === q.graded[i])) {
			identical++;
			console.log(`${q.id}　两份名单在评审范围内顺序相同`);
			continue;
		}
		if (!answer) {
			blank++;
			continue;
		}
		if (answer === "无法判断") {
			skipped++;
			continue;
		}
		const priority = (p: string) => {
			const i = picks.indexOf(p);
			return i < 0 ? picks.length : i;
		};
		let old = 0,
			graded = 0;
		for (const [i, a] of q.baseline.entries())
			for (const b of q.baseline.slice(i + 1)) {
				if (q.graded.indexOf(a) < q.graded.indexOf(b)) continue;
				const diff = priority(a) - priority(b);
				if (diff < 0) old++;
				if (diff > 0) graded++;
			}
		if (old > graded) oldWins++;
		else if (graded > old) newWins++;
		else tied++;
		console.log(
			`${q.id}　HR 明确区分的逆序对：原排序 ${old}，匹配分排序 ${graded}`,
		);
	}
	console.log(
		`按需求汇总　匹配分排序胜 ${newWins}，原排序胜 ${oldWins}，平局 ${tied}，顺序相同 ${identical}，无法判断 ${skipped}，未填 ${blank}`,
	);
}

const [mode, path, extra] = process.argv.slice(2);
if (mode === "score" && path) await score(path, extra ?? join(path, "盲评.md"));
else if (mode === "run")
	await prepare(
		path ?? "evals/match/sample.json",
		extra ?? "evals/match/runs",
		false,
	);
else if (mode === "corpus" && path) {
	try {
		await prepare(path, extra ?? "evals/match/runs", true);
	} finally {
		const { pool } = await import("#/db");
		await pool.end();
	}
} else
	throw new Error(
		"用法：eval:match run [用例.json] [输出目录] 、corpus 查询.json 或 eval:match score 批次目录 [已填盲评.md]",
	);
