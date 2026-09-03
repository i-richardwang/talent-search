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

/**
 * 一句原话自身的理解：模型或规则解析对这一句给出的结果，原样落在这条记录上。
 *
 * 它和 `spec` 的区别不是形状，是**出处**——`spec` 可能被人逐枚改过条件，而它
 * 永远是那次理解的原样。所以「这条查询还能不能重新理解」只能问它
 * （`server/turn.ts`）：问 `spec` 的话，改过条件的记录也会被当成理解的产物。
 */
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
	| { kind: "reinterpret" };

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
 * 一份理解 → 一份可执行的查询含义。证据按全站规范查询串走一遍往返，同一个词
 * 只留一枚；提示按内容去重。模型和规则解析都可能把同一个意思说两遍，
 * 而屏幕上重复的两枚 chip 既解释不清也删不干净。
 */
export function normalizeSpec(delta: SearchDelta): SearchSpec {
	const notices = delta.notices.filter(
		(n, i, all) =>
			all.findIndex(
				(x) =>
					x.kind === n.kind &&
					(x.kind !== "unsupported" ||
						(n.kind === "unsupported" && x.text === n.text)),
			) === i,
	);
	return {
		evidence: parseChips(toQuery(delta.evidence)),
		scope: { ...delta.scope },
		notices,
	};
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

	return normalizeSpec({
		evidence: parseChips(toQuery(drafts)),
		scope,
		notices,
	});
}
