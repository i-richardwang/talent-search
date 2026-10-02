/**
 * 入职前经历对齐到登记序列树上完整的一对，存入推断列，仅用于筛选。
 * 两级均空是合法的无法对齐；无效回答返回 null，派生下一轮重试。
 */

import { z } from "zod";
import { complete, extractModel, identityOf } from "#/server/chat";
import { promptInput } from "./extract";
import type { ExperienceRow } from "./pipeline";
import type { Report } from "./report";

const SCHEMA = z.object({ l1: z.string(), l2: z.string() });

/** 树上的一对：一级 · 二级。 */
export type SeqPair = [string, string];

/** 拼一对序列时的分隔符：控制字符，序列名里不可能出现它。 */
const PAIR = "\u001f";

/**
 * 公司内任职段登记过的（一级，二级）全集，去重排序。只有一级的登记不算：
 * 对齐要的是能进筛选的一对，而序列筛选只认成对的值。
 */
export function seqTree(
	experience: Pick<ExperienceRow, "kind" | "seq_l1" | "seq_l2">[],
): SeqPair[] {
	const pairs = new Set<string>();
	for (const row of experience)
		if (row.kind === "internal" && row.seq_l1 && row.seq_l2)
			pairs.add(`${row.seq_l1}${PAIR}${row.seq_l2}`);
	return [...pairs].sort().map((key) => key.split(PAIR) as SeqPair);
}

export function systemPrompt(tree: SeqPair[]): string {
	const listing = tree.map(([l1, l2]) => `- ${l1} · ${l2}`).join("\n");
	return `你在读一段员工入职前的工作经历，判断这段经历在本公司会属于哪个序列。本公司的序列（一级 · 二级）只有下面这些：

${listing}

输出 JSON：{"l1": "一级", "l2": "二级"}

- 只能从上面的列表里选，一级和二级必须是同一行的一对，名字照抄。
- 判断依据是岗位名和描述里实际做的事；公司名只用来理解行业，不能单凭公司名判断。
- 多数经历只有岗位名，没有描述，这是正常的：岗位名本身说明了做什么（产品经理、客服、数据分析师、Java 开发）就按岗位名判断，不因为没有描述而放弃。
- 同一个一级下有几个二级时，选岗位名字面最贴近的那个；二级名就是这类岗位的通称时直接选它。
- 只有岗位名说明不了做什么（经理、专员、管培生、合伙人）、列表里没有相应的序列、或者经历与列表里任何序列都不相关时，l1 和 l2 才都给空字符串。不要硬选一个最接近的。`;
}

function name(value: unknown): string {
	return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

/** 只接受序列树上存在的完整一对，其余取值置空。 */
export function conform(raw: unknown, tree: SeqPair[]): SeqPair {
	if (typeof raw !== "object" || raw === null) return ["", ""];
	const row = raw as Record<string, unknown>;
	const pair: SeqPair = [name(row.l1), name(row.l2)];
	const known = new Set(tree.map(([l1, l2]) => `${l1}${PAIR}${l2}`));
	return known.has(`${pair[0]}${PAIR}${pair[1]}`) ? pair : ["", ""];
}

/** 对齐这一步的身份：模型、带着这棵树的提示词、schema。派生版本的一部分。 */
export function alignIdentity(tree: SeqPair[]): string {
	return identityOf(extractModel(), systemPrompt(tree), SCHEMA);
}

/**
 * 把对到了的入职前段写进 `seq_inferred_l1 / seq_inferred_l2`；其余段保持空。
 *
 * 待业段没有岗位可对，不去问。序列树写在提示词里，也就在缓存的键里：树变了，
 * 旧回答是对着另一棵树给的，自然失效。树是空的（语料里没有登记的序列）就
 * 什么都对不上，直接原样返回。
 */
export async function align<Row extends ExperienceRow>(
	experience: Row[],
	tree: SeqPair[],
	report: Report,
): Promise<(Row | null)[]> {
	if (tree.length === 0) return experience;

	const asked = experience.map((row) =>
		row.kind === "external" && !row.unemployed ? promptInput(row) : null,
	);
	const texts = asked.filter((text): text is string => text !== null);
	const payloads = await complete(
		extractModel(),
		systemPrompt(tree),
		SCHEMA,
		texts,
		"对齐",
		report,
	);

	let aligned = 0;
	const out = experience.map((row, index) => {
		const text = asked[index];
		if (text === null || text === undefined) return row;
		if (!payloads.has(text)) return null;
		const [l1, l2] = conform(payloads.get(text), tree);
		if (!l1) return row;
		aligned++;
		return { ...row, seq_inferred_l1: l1, seq_inferred_l2: l2 };
	});
	report(`  入职前 ${texts.length} 段里 ${aligned} 段有推断序列`);
	return out;
}
