/** 页底「使用规则与代码」：一段最常见的写法，以及这个组件在产品里怎么用。 */
export interface PageRules {
	usage: string;
	notes: string[];
}

/** 页面展开后的两节标题；Markdown 与页面用同一份。 */
export const RULES_HEADINGS = { notes: "要点", usage: "写法" } as const;

/** 围住写法的代码栅栏：比写法里最长的一串反引号多一个，至少三个。 */
function fence(code: string) {
	const longest = Math.max(
		0,
		...(code.match(/`+/g) ?? []).map((run) => run.length),
	);
	return "`".repeat(Math.max(3, longest + 1));
}

/** 一页的使用规则写成 Markdown：标题、源文件、写法、要点。 */
export function rulesMarkdown({
	name,
	rules,
	source,
	title,
}: {
	name?: string;
	rules: PageRules;
	source: readonly string[];
	title: string;
}) {
	const marks = fence(rules.usage);
	return [
		`# ${name ? `${title} ${name}` : title}`,
		"",
		`源文件：${source.map((file) => `\`${file}\``).join("、")}`,
		"",
		`## ${RULES_HEADINGS.usage}`,
		"",
		`${marks}tsx`,
		rules.usage,
		marks,
		"",
		`## ${RULES_HEADINGS.notes}`,
		"",
		...rules.notes.map((note) => `- ${note}`),
		"",
	].join("\n");
}
