import "@tanstack/react-start/server-only";
import { z } from "zod";
import { pendingInputs, saveResults } from "#/corpus/derive-requests";
import { deriveMode, deriveToken } from "#/corpus/derive-standard";
import { withReadSnapshot } from "#/db/snapshot";
import { recordDeriveRead } from "./audit";
import { readBody } from "./request-body";

const MAX_BATCH = 100;
export const DERIVE_BODY_BYTES = 512 * 1024;
const kindOf = z.enum(["extract", "align"]);
const headers = { "Cache-Control": "no-store" };
const response = (value: unknown, status = 200) =>
	Response.json(value, { status, headers });

export function rejectDerive(request: Request) {
	const token = deriveToken();
	if (deriveMode() !== "external" || !token)
		return response({ error: "not found" }, 404);
	if (request.headers.get("authorization") !== `Bearer ${token}`)
		return response({ error: "unauthorized" }, 401);
}

export const deriveOptions = z
	.object({
		kind: kindOf,
		limit: z.coerce.number().int().min(1).max(MAX_BATCH).default(20),
		part: z.coerce.number().int().nonnegative().default(0),
		parts: z.coerce.number().int().min(1).max(1024).default(1),
	})
	.refine((v) => v.part < v.parts);

export async function readDeriveInputs(request: Request) {
	const denied = rejectDerive(request);
	if (denied) return denied;
	const params = deriveOptions.safeParse(
		Object.fromEntries(new URL(request.url).searchParams),
	);
	if (!params.success)
		return response({ error: "请检查 kind、limit、part 和 parts" }, 400);
	return response(await readDeriveBatch(params.data));
}

export async function readDeriveBatch(
	options: z.output<typeof deriveOptions>,
	external = true,
) {
	const { personIds, ...body } = await withReadSnapshot("all", (client) =>
		pendingInputs(client, options),
	);
	if (external) await recordDeriveRead(personIds);
	return body;
}

export function deriveSubmission<T extends z.ZodType>(answer: T) {
	return z.object({
		kind: kindOf,
		standard: z.string().regex(/^[a-f0-9]{64}$/),
		results: z.array(answer).min(1).max(MAX_BATCH),
	});
}
// HTTP 逐项给回执，交错的项目由 saveResults 标记 invalid。
const envelope = deriveSubmission(z.unknown());
export async function receiveDeriveResults(
	request: Request,
	schedule: () => Promise<unknown>,
) {
	const denied = rejectDerive(request);
	if (denied) return denied;
	const raw = await readBody(request, DERIVE_BODY_BYTES);
	if (raw === null) return response({ error: "提交内容超过 512 KiB" }, 413);
	let input: unknown;
	try {
		input = JSON.parse(raw);
	} catch {
		return response({ error: "需要 JSON 格式" }, 400);
	}
	const batch = envelope.safeParse(input);
	if (!batch.success)
		return response(
			{ error: "需要 kind、standard 和 1 至 100 条 results" },
			400,
		);
	return response(await submitDeriveBatch(batch.data, schedule));
}

export async function submitDeriveBatch(
	{ kind, standard, results }: z.output<typeof envelope>,
	schedule?: () => Promise<unknown>,
	model?: string,
) {
	const { receipts, added } = await saveResults(kind, standard, results, model);
	if (added && schedule) {
		try {
			await schedule();
		} catch (error) {
			console.error("解析结果已保存，未能安排下一轮解析", error);
		}
	}
	return { results: receipts };
}
