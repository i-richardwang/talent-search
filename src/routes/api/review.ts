/**
 * 外部判定方的接口：`GET /api/review` 取走待判的词，`POST /api/review` 提交判定。
 *
 * 不走给页面使用的 `createServerFn`：外部判定方要的是普通的 JSON 和状态码。
 * 鉴权与请求格式校验都在 `src/server/review.ts`，这里只把结果译成状态码。
 */

import { createFileRoute } from "@tanstack/react-router";
import { requestJob } from "#/server/jobs";
import {
	authorized,
	configured,
	limitOf,
	pending,
	submit,
} from "#/server/review";

/*
 * 接口没启用（判定不归外部，或没配 `REVIEW_TOKEN`）时回 404 而不是 401：没开的
 * 部署不该让外面看出「这里有个要凭据的接口」。开了但凭据不对才是 401，而且不区分
 * 「没带」和「带错」。
 */
function reject(request: Request): Response | null {
	if (!configured())
		return Response.json({ error: "not found" }, { status: 404 });
	if (!authorized(request))
		return Response.json({ error: "unauthorized" }, { status: 401 });
	return null;
}

export const Route = createFileRoute("/api/review")({
	server: {
		handlers: {
			GET: async ({ request }) =>
				reject(request) ?? Response.json(await pending(limitOf(request.url))),
			POST: async ({ request }) => {
				const denied = reject(request);
				if (denied) return denied;
				const result = await submit(request);
				if (!result.ok)
					return Response.json({ error: result.why }, { status: 400 });
				if (result.submission === "missing")
					return Response.json(
						{ error: "这个词不在队列里，或者判定标准已经更新" },
						{ status: 404 },
					);
				if (result.submission === "taken")
					return Response.json(
						{ error: "这个词已经有人判过了" },
						{ status: 409 },
					);
				// 接收以判定持久化为准；立即整理未排上时，由定时整理继续处理。
				try {
					await requestJob("review");
				} catch (error) {
					console.error("判定已接收，立即整理调度失败：", error);
				}
				return Response.json({ accepted: true });
			},
		},
	},
});
