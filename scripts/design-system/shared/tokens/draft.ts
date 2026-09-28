import { parseColor, sameColor } from "../color";
import {
	isColorToken,
	isSharedValue,
	numericToken,
	parseNumeric,
	type Scope,
	type Theme,
} from "./registry";

/*
 * 修改（代码里叫 draft）：只记与源文件里的值（修改前）不同的令牌，
 * 分三份：浅色、深色各一份颜色，其余令牌两种外观共用一份。
 */

export type TokenValues = Record<string, string>;
export type Draft = Record<Scope, TokenValues>;
/** 修改前的值：浅色一侧（及共用的令牌）与深色一侧。 */
export type Baseline = Record<Theme, TokenValues>;

const SCOPES = ["light", "dark", "shared"] as const;

/** 拖动中、还没提交的一个值：预览里先按它画，松手才写进修改。 */
export interface TokenPreview {
	scope: Scope;
	key: string;
	value: string;
}

export const emptyDraft = (): Draft => ({ dark: {}, light: {}, shared: {} });

/** 全部修改，按变量名排。 */
export const draftEntries = (draft: Draft) =>
	SCOPES.flatMap((scope) =>
		Object.entries(draft[scope]).map(([key, value]) => ({ key, scope, value })),
	).sort((a, b) => a.key.localeCompare(b.key));

export const changeCount = (draft: Draft) => draftEntries(draft).length;

/** 去掉几项修改，这几项回到修改前的值。 */
export function resetTokens(
	draft: Draft,
	scope: Scope,
	keys: readonly string[],
): Draft {
	return {
		...draft,
		[scope]: Object.fromEntries(
			Object.entries(draft[scope]).filter(([key]) => !keys.includes(key)),
		),
	};
}

/** 从存储、消息或请求里读回的修改要逐项校验：键在令牌表里，值是这个令牌能取的写法和范围。 */
export function isDraft(value: unknown): value is Draft {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	if (Object.keys(candidate).sort().join() !== "dark,light,shared")
		return false;
	return SCOPES.every((scope) => {
		const values = candidate[scope];
		if (!values || typeof values !== "object" || Array.isArray(values))
			return false;
		return Object.entries(values).every(
			([key, raw]) =>
				typeof raw === "string" &&
				(scope === "shared"
					? isSharedValue(key, raw)
					: isColorToken(key) && !!parseColor(raw)),
		);
	});
}

/** 在一份修改前的值上读写修改。设计系统用的是绑定源文件的那一份（`source.ts`）。 */
export function draftModel(baseline: Baseline) {
	const originalValue = (scope: Scope, key: string) =>
		baseline[scope === "shared" ? "light" : scope][key];

	/** 某一侧某个令牌现在的值：改过就用修改后的，没改过用修改前的。 */
	const tokenValue = (draft: Draft, scope: Scope, key: string): string => {
		const value = draft[scope][key] ?? originalValue(scope, key);
		if (value === undefined) throw new Error(`没有令牌 ${key}`);
		return value;
	};

	/** 写一项修改；和修改前相同（颜色按通道、数值按换算后的数）就从修改里去掉。 */
	const updateToken = (
		draft: Draft,
		scope: Scope,
		key: string,
		value: string,
	): Draft => {
		const original = originalValue(scope, key) ?? "";
		const numeric = numericToken(key);
		const unchanged =
			scope !== "shared"
				? sameColor(value, original)
				: numeric
					? parseNumeric(numeric, value) === parseNumeric(numeric, original)
					: value.trim() === original.trim();
		return unchanged
			? resetTokens(draft, scope, [key])
			: { ...draft, [scope]: { ...draft[scope], [key]: value } };
	};

	/** 去掉和修改前已经相同的项：源文件改过之后，旧修改里的这些项不再是修改。 */
	const pruneDraft = (draft: Draft): Draft =>
		SCOPES.reduce(
			(pruned, scope) =>
				Object.entries(draft[scope]).reduce(
					(next, [key, value]) => updateToken(next, scope, key, value),
					pruned,
				),
			emptyDraft(),
		);

	return { originalValue, pruneDraft, tokenValue, updateToken };
}
