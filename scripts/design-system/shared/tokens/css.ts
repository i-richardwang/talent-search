import {
	type Baseline,
	changeCount,
	type Draft,
	draftEntries,
	type TokenValues,
} from "./draft";

/*
 * 令牌与 CSS 原文之间：从源文件读出原版的值，把修改版写成预览用的一段 CSS、
 * 导出的补丁，或直接写回源文件。
 */

/** 源文件：仓库里的路径 → 原文。 */
export type Sources = Record<string, string>;

/** 全局令牌所在的文件；深色一侧的颜色都在它的 `.dark` 块里。 */
export const THEME_SOURCE = "src/styles.css";

/**
 * 声明令牌的源文件：全局令牌与各组件的 CSS。设计系统在浏览器里按这组模式取原文
 * （`source-files.ts`），写回源码与测试在磁盘上按同一组模式找文件。
 */
export const TOKEN_SOURCE_PATTERNS = [
	THEME_SOURCE,
	"src/components/ui/*.css",
] as const;

/** 一个顶层块：选择器（`@theme static`、`:root`、`.dark`…）与花括号在原文里的位置。 */
interface Block {
	selector: string;
	open: number;
	close: number;
}

/** 顶层块里直接写的一个自定义属性，值在原文里占 `[start, end)`。 */
interface Declaration {
	block: Block;
	key: string;
	value: string;
	start: number;
	end: number;
}

/** 注释换成等长的空白：切块和找声明时不看注释，位置仍对得上原文。 */
const blankComments = (css: string) =>
	css.replaceAll(/\/\*[\s\S]*?\*\//g, (comment) =>
		comment.replaceAll(/[^\n]/g, " "),
	);

/** 按顶层花括号切块；块里嵌套的规则算在块内。 */
function blocks(css: string): Block[] {
	const clean = blankComments(css);
	const found: Block[] = [];
	let depth = 0;
	let open = 0;
	for (let index = 0; index < clean.length; index++) {
		const char = clean[index];
		if (char === "{") {
			if (depth === 0) open = index;
			depth++;
		} else if (char === "}") {
			depth--;
			if (depth !== 0) continue;
			const selector = clean
				.slice(clean.lastIndexOf("}", open) + 1, open)
				.replace(/^[\s\S]*;/, "")
				.trim();
			found.push({ close: index, open, selector });
		}
	}
	return found;
}

function declarations(css: string): Declaration[] {
	const clean = blankComments(css);
	return blocks(css).flatMap((block) =>
		[
			...clean
				.slice(block.open + 1, block.close)
				.matchAll(/(--[\w-]+)(\s*:\s*)([^;]+);/g),
		].flatMap((match) => {
			const [, key = "", separator = "", raw = ""] = match;
			if (key.endsWith("-*")) return [];
			const value = raw.trim();
			const start =
				block.open + 1 + (match.index ?? 0) + key.length + separator.length;
			return [{ block, end: start + value.length, key, start, value }];
		}),
	);
}

const LIGHT_BLOCK = /^(@theme\b[^{]*|:root)$/;
const DARK_BLOCK = ".dark";

/** 各块里声明的令牌：浅色一侧（`@theme`、`:root`）与 `.dark` 块，各自只含写了的。 */
export function declaredTokens(sources: string[]): Baseline {
	const light: TokenValues = {};
	const dark: TokenValues = {};
	for (const { block, key, value } of sources.flatMap(declarations)) {
		if (LIGHT_BLOCK.test(block.selector)) light[key] = value;
		else if (block.selector === DARK_BLOCK) dark[key] = value;
	}
	return { dark, light };
}

/** 从 CSS 原文读出原版的值：`.dark` 块在浅色一侧上面覆盖深色一侧，没写的沿用浅色。 */
export function readSource(sources: string[]): Baseline {
	const { dark, light } = declaredTokens(sources);
	return { dark: { ...light, ...dark }, light };
}

const block = (selector: string, values: TokenValues) => {
	const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
	return entries.length === 0
		? ""
		: `${selector} {\n${entries.map(([key, value]) => `\t${key}: ${value};`).join("\n")}\n}`;
};

/**
 * 预览里压在源样式上面的一段 CSS。共用值写在 `:root`；两种外观的颜色各自限定在
 * `:root:not(.dark)` 与 `:root.dark` 上，特异性高过源文件的 `:root` 与 `.dark`。
 */
export function previewCss(draft: Draft): string {
	return [
		block(":root", draft.shared),
		block(":root:not(.dark)", draft.light),
		block(":root.dark", draft.dark),
	]
		.filter(Boolean)
		.join("\n");
}

/** 一项修改落到哪里：文件、块，以及原文里现有的那条声明（深色一侧可能还没写）。 */
export interface Placement {
	file: string;
	selector: string;
	key: string;
	value: string;
	declaration?: Declaration;
}

/**
 * 每一项修改回到声明它的那个文件、那个块：浅色的颜色和共用值找浅色一侧的声明
 * （`@theme static`、`@theme`、组件 CSS 的 `:root`），深色的颜色进 `styles.css` 的 `.dark`。
 */
export function placements(draft: Draft, sources: Sources): Placement[] {
	const found = Object.entries(sources).flatMap(([file, css]) =>
		declarations(css).map((declaration) => ({ declaration, file })),
	);
	return draftEntries(draft).flatMap(({ key, scope, value }): Placement[] => {
		if (scope === "dark") {
			const declaration = found.find(
				(item) =>
					item.file === THEME_SOURCE &&
					item.declaration.key === key &&
					item.declaration.block.selector === DARK_BLOCK,
			)?.declaration;
			return [
				{ declaration, file: THEME_SOURCE, key, selector: DARK_BLOCK, value },
			];
		}
		const home = found.find(
			(item) =>
				item.declaration.key === key &&
				LIGHT_BLOCK.test(item.declaration.block.selector),
		);
		return home
			? [
					{
						declaration: home.declaration,
						file: home.file,
						key,
						selector: home.declaration.block.selector,
						value,
					},
				]
			: [];
	});
}

/** 导出的补丁：按文件和块分段，每段写明合进哪里。 */
export function exportCss(draft: Draft, sources: Sources): string {
	if (changeCount(draft) === 0) return "/* 与原版一致 */\n";
	const sections = new Map<
		string,
		{ file: string; selector: string; values: TokenValues }
	>();
	for (const { file, key, selector, value } of placements(draft, sources)) {
		const id = `${file} ${selector}`;
		const section = sections.get(id) ?? { file, selector, values: {} };
		section.values[key] = value;
		sections.set(id, section);
	}
	return `${[...sections.values()]
		.map(
			({ file, selector, values }) =>
				`/* 合进 ${file} 的 \`${selector}\` */\n${block(selector, values)}`,
		)
		.join("\n\n")}\n`;
}

/**
 * 把修改版写回源文件原文：已有的声明原地换值，深色一侧还没写的在 `.dark` 块末尾补一行。
 * 只返回有改动的文件。
 */
export function applyDraft(draft: Draft, sources: Sources): Sources {
	const edits = new Map<string, { at: number; end: number; text: string }[]>();
	for (const { declaration, file, key, value } of placements(draft, sources)) {
		const css = sources[file] ?? "";
		const edit = declaration
			? { at: declaration.start, end: declaration.end, text: value }
			: (() => {
					const dark = blocks(css).find(
						({ selector }) => selector === DARK_BLOCK,
					);
					if (!dark) throw new Error(`${file} 里没有 ${DARK_BLOCK} 块`);
					const at = css.lastIndexOf("\n", dark.close) + 1;
					return { at, end: at, text: `\t${key}: ${value};\n` };
				})();
		edits.set(file, [...(edits.get(file) ?? []), edit]);
	}
	return Object.fromEntries(
		[...edits].map(([file, list]) => [
			file,
			list
				.sort((a, b) => b.at - a.at)
				.reduce(
					(css, { at, end, text }) => css.slice(0, at) + text + css.slice(end),
					sources[file] ?? "",
				),
		]),
	);
}
