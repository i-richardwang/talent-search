/**
 * **应用唯一的 RPC 边界。** 页面能从服务端取值的地方只有这一个文件；真正干活的
 * 逻辑住在 `search.ts` / `turn.ts` / `llm.ts` 那几个服务端专属模块里。
 *
 * `createServerFn` 切走的只是 handler 的**函数体**，所以这里的规矩是：
 * **服务端模块的值只许出现在 `.handler()` 里面。**
 */

import { createServerFn } from "@tanstack/react-start";
import { asc, eq } from "drizzle-orm";
import { db } from "#/db";
import {
	type Employee,
	type Experience,
	employee,
	experience,
} from "#/db/schema";
import { parseChips, QUERY_MAX, queryText } from "#/search/parse";
import type { SearchOutcome } from "#/search/result";
import {
	overview,
	sanitizeFilters,
	sanitizeLimit,
	search,
} from "#/search/search";
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
 * `parseChips`。URL 上剩下的那几个参数只描述「怎么看这批人」，
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
			if (!turn.chips) return { turn, result: null };
			return {
				turn,
				result: await search(turn.chips, data.filters, data.limit),
			};
		},
	);

/**
 * 语料概览：零态用它回答「这个库里有什么」。
 *
 * 不带任何入参，因为它问的是整个语料——一旦让它跟着某次查询走，它就变成
 * 分面的另一份实现了，而分面已经有一份，两份迟早不一致。
 */
export const fetchOverview = createServerFn({ method: "GET" }).handler(
	async () => overview(),
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
		async ({
			data,
		}): Promise<{ employee: Employee; timeline: Experience[] } | null> => {
			const [emp] = await db
				.select()
				.from(employee)
				.where(eq(employee.empId, data.empId));
			if (!emp) return null;
			const timeline = await db
				.select()
				.from(experience)
				.where(eq(experience.empId, data.empId))
				.orderBy(asc(experience.startDate), asc(experience.id));
			return { employee: emp, timeline };
		},
	);

/**
 * 提交一次查询：落一条记录，返回它的 id。
 *
 * 入参收窄放在这里而不是 `createTurn` 里，因为不可信的只有跨进程这一跳——
 * `chips` 来自客户端，必须过 `parseChips`；切法、赘字剥法与数量上限因此只有
 * 一个执行点。
 */
export function validateCommit(d: unknown) {
	const data = (d ?? {}) as Record<string, unknown>;
	const input = (data.input ?? {}) as Record<string, unknown>;
	const parentTurnId =
		typeof data.parentTurnId === "string" && data.parentTurnId
			? data.parentTurnId
			: undefined;
	if (input.kind === "reinterpret") {
		if (!parentTurnId) throw new Error("重新理解需要一条父记录");
		// 纠正说明和原话同一条文本边界；空串收成「没带说明」，不收成空纠正
		const note = queryText(input.note);
		return {
			parentTurnId,
			input: { kind: "reinterpret" as const, ...(note && { note }) },
		};
	}
	if (input.kind === "sentence") {
		const text = queryText(input.text);
		if (!text) throw new Error("查询为空");
		return {
			parentTurnId,
			input: { kind: "sentence" as const, text },
		};
	}
	if (input.kind !== "chips" || typeof input.q !== "string")
		throw new Error("查询格式无效");
	/*
	 * chips 走**规范查询串**进出：客户端在边界上 `toQuery`，这里 `parseChips`。
	 * chip 的词汇表因此只有一份——在这里逐字段挑一遍就是第二份契约，chip
	 * 每长一个带序列化的新字段，挑字段的代码就会把它静默丢一次；而查询串
	 * 的往返保真恰好是 `parseChips(toQuery(c)) === c` 这条全站不变量。
	 * 截断上限见 `QUERY_MAX`：合法序列化到不了那个数，截掉的只会是打端点
	 * 的超长载荷。
	 */
	const chips = parseChips(input.q.slice(0, QUERY_MAX));
	if (chips.length === 0) throw new Error("查询为空");
	return {
		parentTurnId,
		input: { kind: "chips" as const, chips },
	};
}

export const commitTurn = createServerFn({ method: "POST" })
	.validator(validateCommit)
	.handler(({ data }) => createTurn(data.input, data.parentTurnId));

/** 把一条只有原话的记录补上理解结果。工作台挂载后就地调它，不挡导航。 */
export const interpretTurn = createServerFn({ method: "POST" })
	.validator((d: { turnId: unknown }) => ({ turnId: String(d.turnId ?? "") }))
	.handler(({ data }) => resolveTurn(data.turnId));

/** 零态的「最近搜索」。 */
export const recentSearches = createServerFn({ method: "GET" }).handler(
	listRecent,
);
