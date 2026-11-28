import { z } from "zod";

export const touchSchema = z.object({
	touched: z.iso.date().nullable(),
	notes: z.string().trim().max(2000),
});
export type Touch = z.infer<typeof touchSchema>;
