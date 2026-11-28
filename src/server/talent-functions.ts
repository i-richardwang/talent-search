import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { resumeSchema } from "#/ingestion/resume";
import { touchSchema } from "#/ingestion/touch";
import { organizations } from "./accounts";
import { administrator, authenticated } from "./auth-functions";
import { wakeIngestionJob } from "./jobs";
import { collectFiles } from "./resume-files";
import { decideImport, reviewImport, uploadResume } from "./talent-import";
import {
	addTouch,
	changeTouch,
	importBoard,
	removeMember,
	setTalentPool,
} from "./talent-pools";

export const loadImports = createServerFn({ method: "GET" })
	.middleware([authenticated])
	.validator(
		z.object({
			page: z.number().int().positive(),
			pool: z.string().optional(),
			tab: z.enum(["members", "imports"]),
		}),
	)
	.handler(({ context, data }) => importBoard(context.viewer.id, data));
export const reviewResume = createServerFn({ method: "GET" })
	.middleware([authenticated])
	.validator(z.string())
	.handler(({ context, data }) => reviewImport(context.viewer.id, data));
export const changePool = createServerFn({ method: "POST" })
	.middleware([administrator])
	.validator(
		z.object({
			id: z.string().optional(),
			name: z.string().trim().min(1).max(100),
			org: z.string().max(500).nullable(),
		}),
	)
	.handler(({ context, data }) => setTalentPool(context.viewer.id, data));
export const recordTouch = createServerFn({ method: "POST" })
	.middleware([authenticated])
	.validator(
		z.object({ pool: z.string(), person: z.string(), touch: touchSchema }),
	)
	.handler(({ context, data }) =>
		addTouch(context.viewer.id, data.pool, data.person, data.touch),
	);
export const reviseTouch = createServerFn({ method: "POST" })
	.middleware([authenticated])
	.validator(
		z.object({
			pool: z.string(),
			id: z.number().int().positive(),
			touch: touchSchema.nullable(),
		}),
	)
	.handler(({ context, data }) =>
		changeTouch(context.viewer.id, data.pool, data.id, data.touch),
	);
export const dropMember = createServerFn({ method: "POST" })
	.middleware([authenticated])
	.validator(z.object({ pool: z.string(), person: z.string() }))
	.handler(({ context, data }) =>
		removeMember(context.viewer.id, data.pool, data.person),
	);
export const submitDecision = createServerFn({ method: "POST" })
	.middleware([authenticated])
	.validator(
		z.object({
			id: z.string(),
			choice: z.union([
				z.literal("retry"),
				z.object({
					action: z.literal("new"),
					touch: touchSchema.optional(),
					draft: resumeSchema.optional(),
				}),
				z.object({
					action: z.literal("link"),
					personId: z.string().min(1),
					touch: touchSchema.optional(),
					draft: resumeSchema.optional(),
				}),
				z.object({ action: z.literal("cancel") }),
			]),
		}),
	)
	.handler(async ({ context, data }) => {
		const added = await decideImport(context.viewer.id, data.id, data.choice);
		if (added) await wakeIngestionJob("derive");
		if (data.choice === "retry") await wakeIngestionJob("resume-import");
		if (data.choice !== "retry" && data.choice.action === "cancel")
			await collectFiles();
	});
export const addResume = createServerFn({ method: "POST" })
	.middleware([authenticated])
	.validator((input: FormData) => {
		if (!(input instanceof FormData)) throw new Error("请选择 PDF 文件");
		const file = input.get("file"),
			pool = input.get("pool");
		if (
			!(file instanceof File) ||
			typeof pool !== "string" ||
			file.size > 20 * 1024 * 1024
		)
			throw new Error("请选择 20 MB 以内的 PDF 文件");
		const touch = touchSchema.parse({
			touched: input.get("touched") || null,
			notes: input.get("notes") ?? "",
		});
		return { file, pool, touch };
	})
	.handler(async ({ context, data }) => {
		const id = await uploadResume(
			context.viewer.id,
			data.pool,
			data.file.name,
			new Uint8Array(await data.file.arrayBuffer()),
			data.touch,
		);
		await wakeIngestionJob("resume-import");
		return id;
	});

export const poolOrganizations = createServerFn({ method: "GET" })
	.middleware([administrator])
	.handler(({ context }) => organizations(context.viewer.id));
