import { createHash } from "node:crypto";
import { z } from "zod";

/** 队列按标准认答案，模型缓存还区分回答这份标准的模型。 */
export function standardOf(system: string, schema: z.ZodType, model?: string) {
	const parts = [system, JSON.stringify(z.toJSONSchema(schema))];
	if (model) parts.unshift(model);
	return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}
