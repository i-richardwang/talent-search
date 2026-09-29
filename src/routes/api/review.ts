/**
 * 外部判定方的接口：`GET /api/review` 取走待判的组，`POST /api/review` 提交判定。
 *
 * 应用里唯一不走 `createServerFn` 的服务端入口：那个边界给页面用，外部判定方要的是
 * 普通的 JSON 和状态码。鉴权与请求格式校验都在 `src/server/review.ts`，这里只把结果译成状态码。
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

/** 这条接口不给页面用，不处理缓存与内容协商。 */
function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json; charset=utf-8" },
		status,
	});
}

/*
 * 接口没启用（判定不归外部，或没配 `REVIEW_TOKEN`）时回 404 而不是 401：没开的
 * 部署不该让外面看出「这里有个要凭据的接口」。开了但凭据不对才是 401，而且不区分
 * 「没带」和「带错」。
 */
function reject(request: Request): Response | null {
	if (!configured()) return json({ error: "not found" }, 404);
	if (!authorized(request)) return json({ error: "unauthorized" }, 401);
	return null;
}

export const Route = createFileRoute("/api/review")({
	server: {
		handlers: {
			GET: async ({ request }) =>
				reject(request) ?? json(await pending(limitOf(request.url))),
			POST: async ({ request }) => {
				const denied = reject(request);
				if (denied) return denied;
				const result = await submit(request);
				if (!result.ok) return json({ error: result.why }, 400);
				if (result.submission === "missing")
					return json({ error: "这一组不在队列里，或者已经过期" }, 404);
				if (result.submission === "taken")
					return json({ error: "这一组已经有人判过了" }, 409);
				/*
				 * 判定已落库，这里请求一次整理让它尽快生效。请求没排上不告诉外面：
				 * 已有一个排着或在跑时排不上，判定下一轮照样生效。
				 */
				await requestJob("review");
				return json({ accepted: true });
			},
		},
	},
});
