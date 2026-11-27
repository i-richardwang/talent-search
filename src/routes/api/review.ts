/**
 * 外部判定方的接口：`GET /api/review` 取走待判的词，`POST /api/review` 提交判定。
 *
 * 不走给页面使用的 `createServerFn`：外部判定方要的是普通的 JSON 和状态码。
 * 鉴权与请求格式校验都在 `src/server/review.ts`，这里只把结果译成状态码。
 */

import { createFileRoute } from "@tanstack/react-router";
import { requestJob } from "#/server/jobs";
import {
	limitOf,
	pending,
	rejectReview,
	reviewReceipt,
	submit,
} from "#/server/review";

export const Route = createFileRoute("/api/review")({
	server: {
		handlers: {
			GET: async ({ request }) =>
				rejectReview(request) ??
				Response.json(await pending(limitOf(request.url))),
			POST: async ({ request }) => {
				const denied = rejectReview(request);
				if (denied) return denied;
				const receipt = reviewReceipt(
					await submit(request, () => requestJob({ kind: "review" })),
				);
				if (!receipt.status) return Response.json({ accepted: true });
				const status = { invalid: 400, missing: 404, taken: 409 }[
					receipt.status
				];
				return Response.json({ error: receipt.error }, { status });
			},
		},
	},
});
