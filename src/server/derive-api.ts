import "@tanstack/react-start/server-only";
import { z } from "zod";
import {
	deriveMode,
	deriveStandard,
	deriveToken,
} from "#/corpus/derive-standard";
import { pendingInputs, saveResults } from "#/corpus/external-derive";
import { withReadSnapshot } from "#/db/snapshot";
import { recordDeriveRead } from "./audit";
import { readBody } from "./request-body";

const MAX_BATCH = 100;
const kindOf = z.enum(["extract", "align"]);
const headers = { "Cache-Control": "no-store" };
const response = (value: unknown, status = 200) =>
	Response.json(value, { status, headers });

function deny(request: Request) {
	const token = deriveToken();
	if (deriveMode() !== "external" || !token)
		return response({ error: "not found" }, 404);
	if (request.headers.get("authorization") !== `Bearer ${token}`)
		return response({ error: "unauthorized" }, 401);
}

const options = z
	.object({
		kind: kindOf,
		limit: z.coerce.number().int().min(1).max(MAX_BATCH).default(20),
		part: z.coerce.number().int().nonnegative().default(0),
		parts: z.coerce.number().int().min(1).max(1024).default(1),
	})
	.refine((v) => v.part < v.parts);

export async function readDeriveInputs(request: Request) {
	const denied = deny(request);
	if (denied) return denied;
	const params = options.safeParse(
		Object.fromEntries(new URL(request.url).searchParams),
	);
	if (!params.success)
		return response({ error: "请检查 kind、limit、part 和 parts" }, 400);
	const { empIds, ...body } = await withReadSnapshot("all", (client) =>
		pendingInputs(client, params.data),
	);
	await recordDeriveRead(empIds);
	return response(body);
}

const batchOf = z.object({
	kind: kindOf,
	standard: z.string().regex(/^[a-f0-9]{64}$/),
	results: z.array(z.unknown()).min(1).max(MAX_BATCH),
});
export async function receiveDeriveResults(
	request: Request,
	schedule: () => Promise<unknown>,
) {
	const denied = deny(request);
	if (denied) return denied;
	const raw = await readBody(request, 512 * 1024);
	if (raw === null) return response({ error: "提交内容超过 512 KiB" }, 413);
	let input: unknown;
	try {
		input = JSON.parse(raw);
	} catch {
		return response({ error: "需要 JSON 格式" }, 400);
	}
	const batch = batchOf.safeParse(input);
	if (!batch.success)
		return response(
			{ error: "需要 kind、standard 和 1 至 100 条 results" },
			400,
		);
	const { kind, standard, results } = batch.data;
	const current = await withReadSnapshot("all", deriveStandard);
	const { receipts, added } = await saveResults(
		current,
		kind,
		standard,
		results,
	);
	if (added) {
		try {
			await schedule();
		} catch (error) {
			console.error("解析结果已保存，未能安排下一轮解析", error);
		}
	}
	return response({ results: receipts });
}
