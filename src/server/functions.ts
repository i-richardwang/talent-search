/**
 * 页面的 RPC 边界，负责不可信入参校验与接线。
 * 服务端值只在 createServerFn 的 handler 中使用。外部判定接口属于 routes/api/review.ts。
 */

import { createServerFn } from "@tanstack/react-start";
import { TASK_KINDS } from "#/lib/task";
import { validateCommit } from "#/search/commit-input";
import { MAX_TERM_LEN } from "#/search/condition";
import { KEYWORD_FIELDS } from "#/search/keywords";
import { sanitizeFilters, sanitizeLimit } from "#/search/params";
import type { SearchOutcome } from "#/search/result";
import { search, suggest } from "#/search/search";
import { employeeData, employeeDetail, listEmployees } from "./data";
import { type JobKind, requestJob } from "./jobs";
import { understandingConfigured } from "./llm";
import { listSkills, skillDetail } from "./skills";
import { taskLog as runLog, type TaskPages, tasksState } from "./tasks";
import {
	createTurn,
	deleteSearch,
	interpret,
	listRecent,
	loadThread,
	type Turn,
	traceOf,
} from "./turn";

/**
 * 工作台的一次载入：这条查询记录是什么，以及它当前筛选下的结果。
 *
 * **入参里没有检索条件，只有一个 id。** 条件从库里那条记录上取，客户端伪造
 * 不了，也不必再校验一遍——它在写进记录的时候（`commitTurn`）已经过了
 * `sanitizeSpec`。URL 上剩下的那几个参数只描述「怎么看这批人」，
 * 所以它们仍然要过 `sanitizeFilters` / `sanitizeLimit`。
 *
 * 记录和结果一次往返一起取：分成两个端点的话，界面要么串行等两次往返，
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
		}): Promise<{ thread: Turn[]; result: SearchOutcome | null } | null> => {
			// 整条链一次取回：对话栏画的是全部，名单是正看着的这一轮
			const thread = await loadThread(data.turnId);
			const turn = thread?.find((t) => t.id === data.turnId);
			if (!thread || !turn) return null;
			/* 待理解记录先显示线程与等待态；页面通过 interpretTurn 发起理解。 */
			if (!turn.spec) return { thread, result: null };
			return {
				thread,
				result: await search(turn.spec, data.filters, data.limit),
			};
		},
	);

/** 单人详情的显示属性与经历时间线。 */
export const fetchEmployee = createServerFn({ method: "GET" })
	.validator((d: { empId: unknown }) => ({ empId: String(d.empId ?? "") }))
	.handler(({ data }) => employeeDetail(data.empId));

/** 提交一次查询：写一条记录，返回它的 id。入参校验在 `search/commit-input.ts`。 */
export const commitTurn = createServerFn({ method: "POST" })
	.validator(validateCommit)
	.handler(({ data }) => createTurn(data.input, data.from));

/** 理解走到哪一步了。等理解时界面每秒问一次，线程里的步骤边跑边追加。 */
export const turnTrace = createServerFn({ method: "GET" })
	.validator((d: { turnId: unknown }) => ({ turnId: String(d.turnId ?? "") }))
	.handler(({ data }) => traceOf(data.turnId));

/**
 * 把一条只有原话的记录补上理解结果。工作台挂载后就地调它，不挡导航。
 * 失败不抛，返回是哪个环节出了问题（`interpret`）：页面要按它显示提示，而抛出去的错误
 * 到了浏览器只剩一句不能给人看的原文。
 */
export const interpretTurn = createServerFn({ method: "POST" })
	.validator((d: { turnId: unknown }) => ({ turnId: String(d.turnId ?? "") }))
	.handler(({ data }) => interpret(data.turnId));

/**
 * 最近搜索的一页。第一页由**根路由的 loader** 取（`routes/__root.tsx`），导航栏和首页
 * 共用：它是外壳的数据，换屏时不重取。全部记录的抽屉按页往后取。
 */
export const recentSearches = createServerFn({ method: "GET" })
	.validator((d: { page?: unknown; size?: unknown }) => ({
		page: d.page,
		size: Number(d.size),
	}))
	.handler(({ data }) => listRecent(data.page, data.size));

/**
 * 能不能说一句话来找人。和最近搜索一起由根路由取：零态和工作台都据此决定
 * 摆不摆那个说话的框。它只读环境配置，不会失败。
 */
export const understandingOn = createServerFn({ method: "GET" }).handler(() =>
	understandingConfigured(),
);

/**
 * 关键词模式下拉里的候选。哪一个框在问由 `field` 说，三个框的候选不混
 * （`search/search.ts`）。敲一个字就来一次，所以入参限制得很短。
 */
export const suggestTerms = createServerFn({ method: "GET" })
	.validator((d: { field: unknown; q: unknown }) => {
		const field = KEYWORD_FIELDS.find((f) => f === d.field);
		if (!field) throw new Error("没有这个框");
		return { field, q: String(d.q ?? "").slice(0, MAX_TERM_LEN) };
	})
	.handler(({ data }) => suggest(data.field, data.q));

/** 删掉「最近搜索」里的一行，也就是那一次找人任务的整条链。返回删掉的记录 id。 */
export const deleteRecent = createServerFn({ method: "POST" })
	.validator((d: { turnId: unknown }) => ({ turnId: String(d.turnId ?? "") }))
	.handler(({ data }) => deleteSearch(data.turnId));

/** 技能页的词表：按标准词、写法或所属的词找，一页一页地给。 */
export const skillTable = createServerFn({ method: "GET" })
	.validator((d: { q: unknown; page: unknown }) => ({
		q: String(d.q ?? "").slice(0, 64),
		page: Number(d.page) || 1,
	}))
	.handler(({ data }) => listSkills(data.q, data.page));

/** 技能页点开的那一个词：释义、上下从属、其他写法，各自的人数。 */
export const skillTerm = createServerFn({ method: "GET" })
	.validator((d: { word: unknown }) => ({
		word: String(d.word ?? "").slice(0, 64),
	}))
	.handler(({ data }) => skillDetail(data.word));

/**
 * 任务台的全部数据：三种任务各自跑过的记录里的一页，和语料此刻有多少东西。
 *
 * 每一栏要看第几页由页面给，来自地址栏，什么都可能：这里只负责它是个数，
 * 是不是越过了最后一页由 `tasksState` 处理（`dataList` 同一条分工）。
 */
export const tasksStatus = createServerFn({ method: "GET" })
	.validator(
		(pages: TaskPages): TaskPages =>
			Object.fromEntries(
				TASK_KINDS.map((kind) => [kind, Number(pages?.[kind]) || 1]),
			),
	)
	.handler(({ data }) => tasksState(data));

/**
 * 某一次运行输出的每一行。任务台上打开那一次的日志时才取。
 *
 * 和状态分开取：日志能有上千行，而任务台在跑的时候每两秒重新载入一次状态。
 */
export const taskLog = createServerFn({ method: "GET" })
	.validator((d: { runId: unknown }) => ({ runId: Number(d.runId) }))
	.handler(({ data }) => runLog(data.runId));

/**
 * 现在就跑一次派生或整理，立刻返回。
 *
 * **不等它跑完**：一轮是几分钟到几十分钟，而这是一次 HTTP 往返。进度会持续
 * 写进 `task_run` 那一行，页面重新载入状态就看得见。排着或在跑的已经有
 * 一个时返回 `queued: false`，界面照它说明原因——把这件事画成一个转不完的圈会误导人。
 */
export const requestTask = createServerFn({ method: "POST" })
	.validator((kind: JobKind) => {
		if (kind !== "derive" && kind !== "review")
			throw new Error(`没有这种后台任务：${String(kind)}`);
		return kind;
	})
	.handler(
		async ({ data }): Promise<{ queued: boolean }> => ({
			queued: await requestJob(data),
		}),
	);

/** 数据页的人员列表：按名字或工号找，一页一页地给。 */
export const dataList = createServerFn({ method: "GET" })
	.validator((d: { q: unknown; page: unknown }) => ({
		q: String(d.q ?? "").slice(0, 64),
		page: Number(d.page) || 1,
	}))
	.handler(({ data }) => listEmployees(data.q, data.page));

/** 数据页的一个人：档案、每一段、每一段的派生结果。 */
export const dataEmployee = createServerFn({ method: "GET" })
	.validator((d: { empId: unknown }) => ({ empId: String(d.empId ?? "") }))
	.handler(({ data }) => employeeData(data.empId));
