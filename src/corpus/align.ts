/**
 * 入职前经历对齐到登记序列树上完整的一对，存入推断列，仅用于筛选。
 * 两级均空是合法的无法对齐；无效回答返回 null，解析把这一段记为无法判断。
 */

import { z } from "zod";
import { standardOf } from "./answer-standard";
import type { DeriveInput } from "./extract";

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
export function alignment(tree: SeqPair[]) {
	const system = systemPrompt(tree);
	const schema = z.object({ seq: z.enum(["", ...tree.map(line)]) });
	return { system, schema, standard: standardOf(system, schema) };
}

export function alignmentOf(
	row: DeriveInput,
	tree: SeqPair[],
	payload: unknown,
): SeqPair | null {
	if (!tree.length || row.kind !== "external" || row.unemployed)
		return ["", ""];
	return conform(payload, tree);
}
