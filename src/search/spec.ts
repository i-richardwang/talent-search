import { type Chip, parseChips, queryText, toQuery } from "./parse";

/**
 * 一条查询的完整含义。它是查询记录的唯一事实源，也是查询台编辑、最近搜索回放、
 * 搜索执行共同使用的边界；不能执行的部分同样属于这份含义，不能散落在旁路字段里。
 */
export type SearchSpec = {
	evidence: Chip[];
	scope: SearchScope;
	notices: SearchNotice[];
};

/** 一句原话自身产生的理解。保存它是为了重译时能精确替换这一句，而不是从快照反推。 */
export type SearchDelta = SearchSpec;

/**
 * 查询自身的结构化范围。这里的条件来自用户原话，会随 turnId 保存；URL 上同名的
 * 字段只是结果视图的临时收窄，两者在搜索时取交集，但生命周期完全不同。
 */
export type SearchScope = {
	kind?: "internal" | "external";
	minMonths?: number;
	companyTag?: string;
	level?: string;
	recruitment?: string;
	education?: string;
	org?: string;
	school?: string;
};

export type SearchNotice =
	| { kind: "unsupported"; text: string }
	| { kind: "fallback" };

export type QueryInput =
	| { kind: "sentence"; text: string }
	| { kind: "spec"; spec: SearchSpec }
	| { kind: "reinterpret"; note?: string };

export function emptySpec(): SearchSpec {
	return { evidence: [], scope: {}, notices: [] };
}

export function unsupportedOf(spec: SearchSpec) {
	return spec.notices
		.filter(
			(n): n is Extract<SearchNotice, { kind: "unsupported" }> =>
				n.kind === "unsupported",
		)
		.map((n) => n.text);
}

export function fellBack(spec: SearchSpec) {
	return spec.notices.some((n) => n.kind === "fallback");
}

export function hasMeaning(spec: SearchSpec) {
	return (
		spec.evidence.length > 0 ||
		Object.keys(spec.scope).length > 0 ||
		spec.notices.length > 0
	);
}

/**
 * 追加一句话只在这里合并。证据按全站规范查询串去重；一个结构化维度只能有一个
 * 当前值，新句明确提到同一维时替换旧值；提示按内容去重并保留基线。
 */
export function mergeSpec(base: SearchSpec, delta: SearchDelta): SearchSpec {
	const evidence = parseChips(
		[toQuery(base.evidence), toQuery(delta.evidence)].filter(Boolean).join(","),
	);
	const notices = [...base.notices, ...delta.notices].filter(
		(n, i, all) =>
			all.findIndex(
				(x) =>
					x.kind === n.kind &&
					(x.kind !== "unsupported" ||
						(n.kind === "unsupported" && x.text === n.text)),
			) === i,
	);
	return { evidence, scope: { ...base.scope, ...delta.scope }, notices };
}

const MODES = new Set(["must", "boost", "exclude"]);

/** 不可信的 RPC 入参 → 完整查询；所有查询编辑都在这一边界整体收窄。 */
export function sanitizeSpec(raw: unknown): SearchSpec {
	const value = (raw ?? {}) as Record<string, unknown>;
	const drafts: Chip[] = [];
	for (const item of Array.isArray(value.evidence) ? value.evidence : []) {
		const x = (item ?? {}) as Record<string, unknown>;
		const term = queryText(x.term);
		if (!term) continue;
		const alts = Array.isArray(x.alts)
			? x.alts.flatMap((a) => {
					const text = queryText(a);
					return text ? [text] : [];
				})
			: undefined;
		drafts.push({
			term,
			...(alts?.length && { alts }),
			mode: MODES.has(String(x.mode)) ? (x.mode as Chip["mode"]) : "must",
			...(x.off === true && { off: true as const }),
			...(x.wide === true && x.off === true && { wide: true as const }),
		});
	}

	const source = (value.scope ?? {}) as Record<string, unknown>;
	const text = (x: unknown) => queryText(x);
	const months = Number(source.minMonths);
	const scope: SearchScope = {
		kind:
			source.kind === "internal" || source.kind === "external"
				? source.kind
				: undefined,
		minMonths: Number.isInteger(months) && months > 0 ? months : undefined,
		companyTag: text(source.companyTag),
		level: text(source.level),
		recruitment: text(source.recruitment),
		education: text(source.education),
		org: text(source.org),
		school: text(source.school),
	};
	for (const key of Object.keys(scope) as (keyof SearchScope)[])
		if (scope[key] === undefined) delete scope[key];

	const notices: SearchNotice[] = [];
	for (const item of Array.isArray(value.notices) ? value.notices : []) {
		const x = (item ?? {}) as Record<string, unknown>;
		if (x.kind === "fallback") notices.push({ kind: "fallback" });
		if (x.kind === "unsupported") {
			const message = text(x.text);
			if (message) notices.push({ kind: "unsupported", text: message });
		}
	}

	return mergeSpec(emptySpec(), {
		evidence: parseChips(toQuery(drafts)),
		scope,
		notices,
	});
}
