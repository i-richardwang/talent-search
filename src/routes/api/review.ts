/**
 * 外部裁判的接口：`GET /api/review` 拉题，`POST /api/review` 交卷。
 *
 * 一条路径两个动作，因为它们是同一件事的两头：拿走一道题，把它答回来。分成
 * `/questions` 和 `/answers` 只是把同一个资源写成两个名字。
 *
 * 这是应用里**唯一**不走 `createServerFn` 的服务端入口。那个边界是给页面用的
 * （`src/server/functions.ts`），它的入参出参是 TypeScript 的形状、编码是自己的；
 * 外部 agent 要的是一份说得清的 JSON 和几个状态码，所以这里写成普通的 HTTP。
 *
 * 认人与形状都在 `src/server/review.ts`，这个文件只把下场译成状态码。
 */

import { createFileRoute } from "@tanstack/react-router";
import { requestJob } from "#/server/jobs";
import {
	answer,
	authorized,
	configured,
	limitOf,
	questions,
} from "#/server/review";

/** 一份 JSON 响应。这条接口不给页面用，不必操心缓存与内容协商。 */
function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json; charset=utf-8" },
		status,
	});
}

/*
 * 没开这道口子（判卷不归外部，或没配 `REVIEW_TOKEN`）时回 404 而不是 401：没开的
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
				reject(request) ?? json(await questions(limitOf(request.url))),
			POST: async ({ request }) => {
				const denied = reject(request);
				if (denied) return denied;
				const result = await answer(request);
				if (!result.ok) return json({ error: result.why }, 400);
				if (result.submission === "missing")
					return json({ error: "这道题不在队列里，或者已经过期" }, 404);
				if (result.submission === "taken")
					return json({ error: "这道题已经有人答过了" }, 409);
				/*
				 * 答卷已经落库，这里只是催一次结算，好让这条决定几分钟内生效，而不是
				 * 等第二天那一轮。催没催动不告诉外面：排着或在跑的已经有一个时催不动，
				 * 答卷也不会因此丢，下一轮照样结算——什么时候生效是服务端自己的事，
				 * 交卷的一方只需要知道「收下了」。
				 */
				await requestJob("review");
				return json({ accepted: true });
			},
		},
	},
});
