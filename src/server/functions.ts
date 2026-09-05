/**
 * **应用唯一的 RPC 边界。** 页面能从服务端取值的地方只有这一个文件；真正干活的
 * 逻辑住在 `search.ts` / `turn.ts` / `llm.ts` 那几个服务端专属模块里。
 *
 * `createServerFn` 切走的只是 handler 的**函数体**，所以这里的规矩是：
 * **服务端模块的值只许出现在 `.handler()` 里面。**
 */

import { createServerFn } from "@tanstack/react-start";
import { asc, eq } from "drizzle-orm";
import { withCorpusSnapshot } from "#/db";
import {
	type Employee,
	type Experience,
	employee,
	experience,
} from "#/db/schema";
import { validateCommit } from "#/search/commit-input";
import { sanitizeFilters, sanitizeLimit } from "#/search/params";
import type { SearchOutcome } from "#/search/result";
import { search } from "#/search/search";
import {
	createTurn,
	listRecent,
	loadTurn,
	resolveTurn,
	type Turn,
} from "./turn";

/**
 * 工作台的一次载入：这条查询记录是什么，以及它当前筛选下的结果。
 *
 * **入参里没有检索条件，只有一个 id。** 条件从库里那条记录上取，客户端伪造
 * 不了，也不必再收窄一遍——它在写进记录的时候（`commitTurn`）已经过了
 * `sanitizeSpec`。URL 上剩下的那几个参数只描述「怎么看这批人」，
 * 所以它们仍然要过 `sanitizeFilters` / `sanitizeLimit`。
 *
 * 记录和结果一次往返一起取：分成两个端点的话，界面要么串行等两跳，
 * 要么并发发出两条却在「还没理解」这一支上白跑一次检索。
 */
export const loadWorkbench = createServerFn({ method: "GET" })
	.validator((d: { turnId: unknown; filters?: unknown; limit?: unknown }) => ({
		turnId: String(d.turnId ?? ""),
		filters: sanitizeFilters(d.filters),
		limit: sanitizeLimit(d.limit),
	}))
	.handler(
		async ({
			data,
		}): Promise<{ turn: Turn; result: SearchOutcome | null } | null> => {
			const turn = await loadTurn(data.turnId);
			if (!turn) return null;
			/*
			 * 还没理解完：不跑检索，先把工作台交出去。
			 *
			 * 这一支是整套设计里那句「转圈发生在结果将要出现的地方」的落点——
			 * 页面拿着一条只有原话的记录就能把工作台画出来，模型那一跳由界面
			 * 自己去补（`interpretTurn`），而不是让导航停在原地等它。
			 */
			if (!turn.spec) return { turn, result: null };
			return {
				turn,
				result: await search(turn.spec, data.filters, data.limit),
			};
		},
	);

/**
 * 单人详情：完整档案加一条在职与入职前连起来的时间线。
 *
 * 整行出门是有意的：`employee` 的列集合本来就是按详情页要显示什么定的，
 * 所以 `Employee` 就是这个响应的形状，不是省事。收窄的那条路在 `result.ts`
 * 的 `ResultEmployee`（列表一次传最多 500 人，只传结果那一块画得出来的几个字段）。
 */
export const fetchEmployee = createServerFn({ method: "GET" })
	.validator((d: { empId: unknown }) => ({ empId: String(d.empId ?? "") }))
	.handler(
		({
			data,
		}): Promise<{ employee: Employee; timeline: Experience[] } | null> =>
			withCorpusSnapshot(async (store) => {
				const [emp] = await store
					.select()
					.from(employee)
					.where(eq(employee.empId, data.empId));
				if (!emp) return null;
				const timeline = await store
					.select()
					.from(experience)
					.where(eq(experience.empId, data.empId))
					.orderBy(asc(experience.startDate), asc(experience.id));
				return { employee: emp, timeline };
			}),
	);

/** 提交一次查询：落一条记录，返回它的 id。入参收窄在 `search/commit-input.ts`。 */
export const commitTurn = createServerFn({ method: "POST" })
	.validator(validateCommit)
	.handler(({ data }) => createTurn(data.input, data.parentTurnId));

/** 把一条只有原话的记录补上理解结果。工作台挂载后就地调它，不挡导航。 */
export const interpretTurn = createServerFn({ method: "POST" })
	.validator((d: { turnId: unknown }) => ({ turnId: String(d.turnId ?? "") }))
	.handler(({ data }) => resolveTurn(data.turnId));

/**
 * 顶栏「最近」入口的列表。由**根路由的 loader** 取（`routes/__root.tsx`）：
 * 它是外壳的数据，两屏都用。放进弹层里按需取的话，每打开一次都要先转一圈，
 * 而它是「偶尔回头找一下」的东西，那一圈正好挡在人要找的那份列表前面。
 */
export const recentSearches = createServerFn({ method: "GET" }).handler(() =>
	listRecent(),
);
