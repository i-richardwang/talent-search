import { type CatalogPage, catalog } from "../shared/catalog";
import { COLOR_TOKENS } from "../shared/tokens/registry";

/*
 * 影响范围：一个令牌在代码里被读到的地方。两种读法：直接引用变量（`var(--x)`、
 * Tailwind 的 `w-(--x)` 写法），以及 Tailwind 按主题命名空间由它生成的工具类
 * （`--color-primary` → `bg-primary`、`text-primary`…；`--radius-md` → `rounded-md`）。
 * 同一套识别也用来算一页的颜色：这一页源文件里读到的颜色令牌。
 */

/** 颜色令牌能生成的工具类前缀。 */
const COLOR_UTILITIES = [
	"accent",
	"bg",
	"border",
	"border-[trblxyse]",
	"caret",
	"decoration",
	"divide",
	"fill",
	"from",
	"inset-ring",
	"outline",
	"placeholder",
	"ring",
	"ring-offset",
	"shadow",
	"stroke",
	"text",
	"to",
	"via",
].join("|");

const literal = (text: string) =>
	text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 工具类的名字前后不能再接字母、数字或连字符：`text-fg` 不算进 `text-fg-secondary`。 */
const utility = (prefixes: string, name: string) =>
	new RegExp(
		`(?<![\\w-])(?:${prefixes})-${literal(name)}(?:/[\\w.]+)?(?![\\w-])`,
		"g",
	);

/** 这个令牌在代码里会以哪些写法出现。 */
function patternsOf(key: string): RegExp[] {
	const direct = new RegExp(`${literal(key)}(?![\\w-])(?!\\s*:)`, "g");
	const [, namespace = "", name = ""] =
		/^--(color|radius|text|container|ease)-(.+?)(?:--line-height)?$/.exec(
			key,
		) ?? [];
	const generated = {
		color: utility(COLOR_UTILITIES, name),
		container: utility("w|min-w|max-w", name),
		ease: utility("ease", name),
		radius: utility("rounded(?:-[setblr]{1,2})?", name),
		text: utility("text", name),
	}[namespace];
	return generated ? [direct, generated] : [direct];
}

export interface Usage {
	file: string;
	count: number;
}

/** 一个令牌在每个文件里被读到几次；没读到的文件不列。 */
export function usagesOf(key: string, files: Record<string, string>): Usage[] {
	const patterns = patternsOf(key);
	return Object.entries(files).flatMap(([file, text]) => {
		const count = patterns.reduce(
			(sum, pattern) => sum + (text.match(pattern)?.length ?? 0),
			0,
		);
		return count > 0 ? [{ count, file }] : [];
	});
}

/** 一页演示的文件：目录里写的源文件，组件的 TSX 连同它同名的 CSS。 */
const pageFiles = (page: CatalogPage): string[] =>
	(page.source ?? []).flatMap((file) =>
		file.startsWith("src/components/ui/")
			? [file, file.replace(/\.tsx$/, ".css")]
			: [file],
	);

/** 一个文件出现在哪几页。 */
export const pagesOfFile = (file: string): CatalogPage[] =>
	catalog.flatMap((module) =>
		module.pages.filter((page) => pageFiles(page).includes(file)),
	);

/**
 * 右栏先列的本页颜色：有源文件的页取源文件里读到的颜色令牌，按颜色表的顺序；
 * 没有源文件的页取目录里写的。
 */
export function pageColors(
	page: CatalogPage,
	files: Record<string, string>,
): string[] {
	if (!page.source) return [...(page.colors ?? [])];
	const texts = Object.fromEntries(
		pageFiles(page).flatMap((file) => {
			const text = files[file];
			return text === undefined ? [] : [[file, text]];
		}),
	);
	return COLOR_TOKENS.flatMap(([key]) =>
		usagesOf(key, texts).length > 0 ? [key] : [],
	);
}
