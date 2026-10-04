/**
 * 入职前经历对齐到登记序列树上完整的一对，存入推断列，仅用于筛选。
 * 两级均空是合法的无法对齐；无效回答返回 null，派生下一轮重试。
 */

import { z } from "zod";
import { complete, extractModel, identityOf } from "#/server/chat";
import { promptInput } from "./extract";
import type { ExperienceRow } from "./pipeline";
import type { Report } from "./report";

const SCHEMA = z.object({ seq: z.string() });

/** 树上的一对：一级 · 二级。 */
export type SeqPair = [string, string];

/**
 * 提示词里列出的一行，也是模型照抄回来的取值。二级在前：模型按岗位名判断的是二级，
 * 回答按字序写出，先写下的部分限定后面能选什么。
 */
function line([l1, l2]: SeqPair): string {
	return `${l2}（${l1}）`;
}

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
	const listing = tree.map((pair) => `- ${line(pair)}`).join("\n");
	return `你在读一段员工入职前的工作经历，判断这段经历在本公司会属于哪个序列。本公司的序列只有下面这些，每行是「二级（所属一级）」：

${listing}

输出 JSON：{"seq": "列表里的一行"}

- 只能从上面的列表里选一行，整行照抄（不带开头的「- 」）。
- 判断依据是岗位名和描述里实际做的事；公司名只用来理解行业，不能单凭公司名判断。
- 多数经历只有岗位名，没有描述，这是正常的：岗位名本身说明了做什么（产品经理、客服、数据分析师、Java 开发）就按岗位名判断，不因为没有描述而放弃。
- 同一个一级下有几个二级时，选岗位名字面最贴近的那个；二级名就是这类岗位的通称时直接选它。
- 只有岗位名说明不了做什么（经理、专员、管培生、合伙人）、列表里没有相应的序列、或者经历与列表里任何序列都不相关时，seq 才给空字符串。不要硬选一个最接近的。`;
}

/** 树上的完整一对或两级均空；其余回答无效。 */
export function conform(raw: unknown, tree: SeqPair[]): SeqPair | null {
	const parsed = SCHEMA.safeParse(raw);
	if (!parsed.success) return null;
	const picked = parsed.data.seq.trim();
	if (!picked) return ["", ""];
	return tree.find((pair) => line(pair) === picked) ?? null;
}

/** 取值是树上的整行，一级和二级必定出自同一行；随树进入回答形状和版本身份。 */
function alignmentSchema(tree: SeqPair[]) {
	return z.object({ seq: z.enum(["", ...tree.map(line)]) });
}

/** 派生版本的一部分。 */
export function alignIdentity(tree: SeqPair[]): string {
	return identityOf(extractModel(), systemPrompt(tree), alignmentSchema(tree));
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
		alignmentSchema(tree),
		texts,
		"对齐",
		report,
	);

	let aligned = 0;
	const out = experience.map((row, index) => {
		const text = asked[index];
		if (text === null || text === undefined) return row;
		if (!payloads.has(text)) return null;
		const pair = conform(payloads.get(text), tree);
		if (!pair) {
			report("  对齐回答不是序列树上的完整一对或两级均空，放弃这一段");
			return null;
		}
		const [l1, l2] = pair;
		if (!l1) return row;
		aligned++;
		return { ...row, seq_inferred_l1: l1, seq_inferred_l2: l2 };
	});
	report(`  入职前 ${texts.length} 段里 ${aligned} 段有推断序列`);
	return out;
}
