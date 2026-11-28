import { z } from "zod";
import { resumeSchema } from "./resume";
import { touchSchema } from "./touch";

const edits = { draft: resumeSchema.optional(), touch: touchSchema.optional() };

export const decisionSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("new"), ...edits }),
	z.object({
		action: z.literal("link"),
		personId: z.string().min(1),
		...edits,
	}),
	z.object({ action: z.literal("cancel") }),
]);
export type Decision = z.infer<typeof decisionSchema>;
