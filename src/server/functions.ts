/**
 * **应用唯一的 RPC 边界。** 页面能从服务端取值的地方只有这一个文件；真正干活的
 * 逻辑住在 `search.ts` / `turn.ts` / `llm.ts` 那几个服务端专属模块里。
 *
 * 只有一个边界文件是有理由的：`createServerFn` 的 handler 被插件切走，但同一个
 * 文件里 handler **之外**的代码照进客户端 bundle。所以这里的规矩是——
 * **服务端模块的值只许出现在 `.handler()` 里面**，一个都不许漏到外面。多开一个
 * 边界文件就多一处能违反这条规矩的地方，而违反的表现是浏览器白屏、SSR 正常。
 */

import { createServerFn } from "@tanstack/react-start";
import { asc, eq } from "drizzle-orm";
import { db } from "#/db";
import { employee, experience } from "#/db/schema";
import { CHIP_MAX, parseChips, queryText, toQuery } from "#/search/parse";
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
			 * 页面拿着一条只有原话的记录就能把三栏画出来，模型那一跳由界面
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

/** 单人时间线：在职与入职前经历连续排列 */
export const fetchEmployee = createServerFn({ method: "GET" })
	.validator((d: { empId: unknown }) => ({ empId: String(d.empId ?? "") }))
	.handler(async ({ data }) => {
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
	});

/**
 * 提交一次查询：落一条记录，返回它的 id。
 *
 * 入参收窄放在这里而不是 `createTurn` 里，因为不可信的只有跨进程这一跳——
 * `chips` 来自客户端，和 URL、模型输出一样要过 `parseChips`，切法、赘字剥法、
 * 数量上限于是和别处完全一致。
 */
export const commitTurn = createServerFn({ method: "POST" })
	.validator((d: { parentTurnId?: unknown; input: unknown }) => {
		const input = (d.input ?? {}) as Record<string, unknown>;
		const parentTurnId =
			typeof d.parentTurnId === "string" && d.parentTurnId
				? d.parentTurnId
				: undefined;
		if (input.kind === "sentence") {
			const text = queryText(input.text);
			if (!text) throw new Error("查询为空");
			return { parentTurnId, input: { kind: "sentence" as const, text } };
		}
		const chips = parseChips(
			toQuery(
				(Array.isArray(input.chips) ? input.chips : [])
					.slice(0, CHIP_MAX)
					.map((c) => {
						const chip = (c ?? {}) as Record<string, unknown>;
						return {
							term: String(chip.term ?? ""),
							mode:
								chip.mode === "boost" || chip.mode === "exclude"
									? chip.mode
									: ("must" as const),
							...(chip.off === true && { off: true as const }),
						};
					}),
			),
		);
		if (chips.length === 0) throw new Error("查询为空");
		return { parentTurnId, input: { kind: "chips" as const, chips } };
	})
	.handler(({ data }) => createTurn(data.input, data.parentTurnId));

/** 把一条只有原话的记录补上理解结果。工作台挂载后就地调它，不挡导航。 */
export const interpretTurn = createServerFn({ method: "POST" })
	.validator((d: { turnId: unknown }) => ({ turnId: String(d.turnId ?? "") }))
	.handler(({ data }) => resolveTurn(data.turnId));

/** 零态的「最近搜索」。 */
export const recentSearches = createServerFn({ method: "GET" }).handler(
	listRecent,
);
