import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { chatConfigured } from "#/server/chat";
import { alignment, type SeqPair } from "./align";
import { extraction } from "./extract";
import { PHRASING } from "./route-texts";
import type { CorpusClient } from "./session";

export function deriveMode() {
	const mode = process.env.DERIVE_MODE?.trim() || "model";
	if (mode === "external") return mode;
	if (mode === "model") return chatConfigured() ? "model" : "text";
	throw new Error("DERIVE_MODE 只支持 model 或 external");
}

export function deriveToken() {
	const token = process.env.DERIVE_TOKEN?.trim();
	return token && token !== process.env.REVIEW_TOKEN?.trim()
		? token
		: undefined;
}

export async function currentTree(client: CorpusClient): Promise<SeqPair[]> {
	const { rows } = await client.query<SeqPair>({
		text: "select seq_l1, seq_l2 from derive_sequence",
		rowMode: "array",
	});
	// 沿用提示词的字序，排序不受数据库语言设置影响。
	return rows.sort((a, b) => {
		const left = a.join("\u001f");
		const right = b.join("\u001f");
		return left < right ? -1 : left > right ? 1 : 0;
	});
}

/** 只用原文时版本由说法组合决定。启用解析时还包含两项标准，执行方和模型都不影响版本。 */
export async function deriveStandard(client: CorpusClient) {
	const mode = deriveMode();
	const parts = [PHRASING];
	const tree = mode === "text" ? [] : await currentTree(client);
	const align = alignment(tree);
	if (mode !== "text") parts.push(extraction.standard, align.standard);
	const version = createHash("sha256")
		.update(parts.join("\u001f"))
		.digest("hex");
	return { mode, version, tree, extract: extraction, align };
}

export type DeriveStandard = Awaited<ReturnType<typeof deriveStandard>>;

/** 待解析的段：正式表里不是这一版，暂存的新结果里也没有。 */
export const UNDERIVED = `e.derived_identity is distinct from $1
	and not exists (select 1 from experience_next n
		where n.experience_id = e.id and n.derived_identity = $1)`;
