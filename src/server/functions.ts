/**
 * 页面的 RPC 边界，负责不可信入参校验与接线。
 * 服务端值只在 createServerFn 的 handler 中使用。外部判定接口属于 routes/api/review.ts。
 */

import { createServerFn } from "@tanstack/react-start";
import type { Scope } from "#/db/snapshot";
import { tableQuery } from "#/lib/paging";
import { rejudgeOf, TASK_KINDS } from "#/lib/task";
import { validateCommit } from "#/search/commit-input";
import { KEYWORD_FIELDS, KEYWORD_RULES } from "#/search/keywords";
import { sanitizeFilters, sanitizeLimit } from "#/search/params";
import type { SearchOutcome } from "#/search/result";
import { search, suggest } from "#/search/search";
import { RESULT_MAX } from "#/search/weights";
import { listAudit, recordExport, recordView } from "./audit";
import { administrator, authenticated } from "./auth-functions";
import {
	allVisible,
	employeeData,
	employeeDetail,
	employeeNumberToPerson,
	listEmployees,
} from "./data";
import { explainThread, type ThreadTurn } from "./explain";
import { type JobKind, requestJob } from "./jobs";
import { understandingConfigured } from "./llm";
import { sourcesFor } from "./resume-files";
import { reviewJudge } from "./review";
import {
	taskLog as runLog,
	setAutomaticDerive,
	type TaskPages,
	tasksState,
} from "./tasks";
import { describeTerm, listTerms } from "./terms";
import {
	createTurn,
	deleteSearch,
	listRecent,
	loadAttempt,
	loadThread,
	processTurn,
	restartTurn,
} from "./turn";

/**
 * 按记录 id 载入完整线程和当前筛选下的结果。线程上每条条件带着它实际要什么的说明
 * （`explain.ts`）。条件来自已校验的查询记录；视图入参在此独立校验。
 * 待理解记录只返回线程，工作台读进度等它理解完。
 * 只在当前账号自己的记录里找（`turn.ts`）：别人的记录和不存在的一样是 null。
 */
export const loadWorkbench = createServerFn({ method: "GET" })
	.middleware([authenticated])
	.validator((d: { turnId: unknown; filters?: unknown; limit?: unknown }) => ({
		turnId: String(d.turnId ?? ""),
		filters: sanitizeFilters(d.filters),
		limit: sanitizeLimit(d.limit),
	}))
	.handler(
		async ({
			data,
			context,
		}): Promise<{
			thread: ThreadTurn[];
			result: SearchOutcome | null;
		} | null> => {
			// 整条链一次取回：对话栏画的是全部，名单是正看着的这一轮
			const chain = await loadThread(context.viewer.id, data.turnId);
			const turn = chain?.find((t) => t.id === data.turnId);
			const head = chain?.[0];
			if (!chain || !turn || !head) return null;
			const thread = await explainThread(chain);
			if (!turn.spec) return { thread, result: null };
			return {
				thread,
				result: await search(turn.spec, head.id, data.filters, data.limit),
			};
		},
	);

/**
 * 把一个人的详情交给这个账号：它的数据范围里有这个人就先记一行「查看」。取个人详情的入口
 * 都经过这里；范围外的人和没有这个人一样是 null。
 */
async function viewed<T extends { employee: { personId: string } }>(
	viewer: { id: string },
	personId: string,
	load: (scope: Scope, personId: string) => Promise<T | null>,
) {
	const scope = { account: viewer.id };
	let detail = await load(scope, personId);
	if (!detail) {
		const mapped = await employeeNumberToPerson(scope, personId);
		if (mapped) detail = await load(scope, mapped);
	}
	if (!detail) return null;
	const sources = await sourcesFor(viewer.id, detail.employee.personId);
	await recordView(viewer.id, detail.employee.personId);
	return { ...detail, sources };
}

/** 单人详情的显示属性与经历时间线。 */
export const fetchEmployee = createServerFn({ method: "GET" })
	.middleware([authenticated])
	.validator((d: { personId: unknown }) => ({
		personId: String(d.personId ?? ""),
	}))
	.handler(({ data, context }) =>
		viewed(context.viewer, data.personId, employeeDetail),
	);

/**
 * 提交一次查询：写一条记录，返回它的 id。入参校验在 `search/commit-input.ts`。
 * 要 AI 接着处理的一轮（说了一句话，或者改完条件有候选人要确认）在这里开始，不等它完成：
 * 页面先进工作台，在那里读进度。
 */
export const commitTurn = createServerFn({ method: "POST" })
	.middleware([authenticated])
	.validator(validateCommit)
	.handler(async ({ data, context }) => {
		const { turnId, attempt } = await createTurn(
			context.viewer.id,
			data.input,
			data.from,
		);
		if (attempt) void processTurn(turnId, attempt);
		return { turnId };
	});

/** AI 处理到哪一步了、这一次从哪一刻开始、成没成。界面串行轮询，相邻读取间隔一秒。 */
export const turnAttempt = createServerFn({ method: "GET" })
	.middleware([authenticated])
	.validator((d: { turnId: unknown }) => ({ turnId: String(d.turnId ?? "") }))
	.handler(({ data, context }) => loadAttempt(context.viewer.id, data.turnId));

/**
 * 人点了重试：上一次失败了就重新开始（`restartTurn`），返回这一轮现在的样子。
 * 上一次还在跑时什么都不做，返回的就是它的进度。
 */
export const retryTurn = createServerFn({ method: "POST" })
	.middleware([authenticated])
	.validator((d: { turnId: unknown }) => ({ turnId: String(d.turnId ?? "") }))
	.handler(async ({ data, context }) => {
		const attempt = await restartTurn(context.viewer.id, data.turnId);
		if (attempt) void processTurn(data.turnId, attempt);
		return loadAttempt(context.viewer.id, data.turnId);
	});

/**
 * 最近搜索的一页。第一页由**根路由的 loader** 取（`routes/__root.tsx`），导航栏和首页
 * 共用：它是外壳的数据，换屏时不重取。全部记录的抽屉按页往后取。
 */
export const recentSearches = createServerFn({ method: "GET" })
	.middleware([authenticated])
	.validator((d: { after?: unknown; size?: unknown }) => ({
		after: d.after,
		size: Number(d.size),
	}))
	.handler(({ data, context }) =>
		listRecent(context.viewer.id, data.size, data.after),
	);

/**
 * 能不能说一句话来找人。和最近搜索一起由根路由取：零态和工作台都据此决定
 * 摆不摆那个说话的框。它只读环境配置，不会失败。
 */
export const understandingOn = createServerFn({ method: "GET" })
	.middleware([authenticated])
	.handler(() => understandingConfigured());

/**
 * 关键词模式下拉里的候选。哪一个框在问由 `field` 指定，各维的候选分开查询
 * （`search/search.ts`）。敲一个字就来一次，所以入参限制得很短。
 */
export const suggestTerms = createServerFn({ method: "GET" })
	.middleware([authenticated])
	.validator((d: { field: unknown; q: unknown }) => {
		const field = KEYWORD_FIELDS.find((f) => f === d.field);
		if (!field) throw new Error("没有这个框");
		return {
			field,
			q: String(d.q ?? "")
				.trim()
				.slice(0, KEYWORD_RULES[field].max),
		};
	})
	.handler(({ data, context }) =>
		suggest({ account: context.viewer.id }, data.field, data.q),
	);

/** 删掉「最近搜索」里的一行，也就是那一次找人任务的整条链。返回删掉的记录 id。 */
export const deleteRecent = createServerFn({ method: "POST" })
	.middleware([authenticated])
	.validator((d: { turnId: unknown }) => ({ turnId: String(d.turnId ?? "") }))
	.handler(({ data, context }) => deleteSearch(context.viewer.id, data.turnId));

/**
 * 一次导出最多记多少人。全选一次是 `RESULT_MAX` 人，换一组筛选可以接着选，所以留出十倍；
 * 再多的不是在名单上选出来的。
 */
const EXPORT_MAX = RESULT_MAX * 10;

/**
 * 导出名单之前调：把要导出的人记进操作记录。文件在页面上生成，页面等这一步成了才生成。
 * 名单上的人都在这个账号的数据范围里；有范围外的工号说明名单不是从名单上选的，整份拒绝。
 */
export const logExport = createServerFn({ method: "POST" })
	.middleware([authenticated])
	.validator((d: { personIds: unknown; accessKeys: unknown }) => {
		const personIds = Array.isArray(d.personIds)
			? [...new Set(d.personIds)]
			: [];
		if (
			!Array.isArray(d.accessKeys) ||
			d.accessKeys.length !== personIds.length ||
			!d.accessKeys.every((x) => typeof x === "string" && x.length === 32) ||
			personIds.length === 0 ||
			personIds.length > EXPORT_MAX ||
			!personIds.every(
				(id): id is string =>
					typeof id === "string" && id.length > 0 && id.length <= 64,
			)
		)
			throw new Error("导出的名单无效");
		return { personIds, accessKeys: d.accessKeys as string[] };
	})
	.handler(async ({ data, context }) => {
		if (
			!(await allVisible(
				{ account: context.viewer.id },
				data.personIds,
				data.accessKeys,
			))
		)
			throw new Error("导出的名单无效");
		await recordExport(context.viewer.id, data.personIds);
	});

/** 审计页的表：按账号、被查看或导出的人、搜索的内容找，一页一页地给。 */
export const auditList = createServerFn({ method: "GET" })
	.middleware([administrator])
	.validator(tableQuery)
	.handler(({ data }) => listAudit(data.q, data.page));

/** 标签页的表：按标准词、写法或所属的词找，一页一页地给。 */
export const termTable = createServerFn({ method: "GET" })
	.middleware([authenticated])
	.validator(tableQuery)
	.handler(({ data, context }) =>
		listTerms({ account: context.viewer.id }, data.q, data.page, false),
	);

/** 判成不是能力的词那张表，供管理员复查判定。 */
export const excludedTable = createServerFn({ method: "GET" })
	.middleware([administrator])
	.validator(tableQuery)
	.handler(({ data, context }) =>
		listTerms({ account: context.viewer.id }, data.q, data.page, true),
	);

/**
 * 标签页点开的那一个词：上下从属、其他写法，各自的人数。判成不是能力的词不是标签，
 * 只有管理员看得到它。
 */
export const termDetail = createServerFn({ method: "GET" })
	.middleware([authenticated])
	.validator((d: { word: unknown }) => ({
		word: String(d.word ?? "").slice(0, 64),
	}))
	.handler(async ({ data, context }) => {
		const term = await describeTerm({ account: context.viewer.id }, data.word);
		return term?.excluded && !context.viewer.admin ? null : term;
	});

/**
 * 把一个范围里的词退回重新判定：发一轮带着这个范围的整理，立刻返回。词表在那一轮
 * 拿到写者锁之后才动。整理关着时不发（`off`）；排着或在跑的已经有一轮时也不发（`busy`），
 * 范围不会并进那一轮，等它跑完再点。
 */
export const rejudgeTerms = createServerFn({ method: "POST" })
	.middleware([administrator])
	.validator((raw: unknown) => {
		const rejudge = rejudgeOf(raw);
		if (!rejudge) throw new Error("没有这种重新判定的范围");
		return rejudge;
	})
	.handler(async ({ data }): Promise<"queued" | "busy" | "off"> => {
		if (reviewJudge() === "off") return "off";
		return (await requestJob({ kind: "review", rejudge: data }))
			? "queued"
			: "busy";
	});

/**
 * 任务台的全部数据：三种任务各自跑过的记录里的一页，和语料此刻有多少东西。
 *
 * 每一栏要看第几页由页面给，来自地址栏，什么都可能：这里只负责它是个数，
 * 是不是越过了最后一页由 `tasksState` 处理（`dataList` 同一条分工）。
 */
export const tasksStatus = createServerFn({ method: "GET" })
	.middleware([administrator])
	.validator(
		(pages: TaskPages): TaskPages =>
			Object.fromEntries(
				TASK_KINDS.map((kind) => [kind, Number(pages?.[kind]) || 1]),
			),
	)
	.handler(({ data }) => tasksState(data));

export const setAutomaticDeriveEnabled = createServerFn({ method: "POST" })
	.middleware([administrator])
	.validator((enabled: boolean) => {
		if (typeof enabled !== "boolean")
			throw new Error("请选择开启或关闭自动解析");
		return enabled;
	})
	.handler(({ data }) => setAutomaticDerive(data));

/**
 * 某一次运行输出的每一行。任务台上打开那一次的日志时才取。
 *
 * 和状态分开取：日志能有上千行，而任务台在跑的时候每两秒重新载入一次状态。
 */
export const taskLog = createServerFn({ method: "GET" })
	.middleware([administrator])
	.validator((d: { runId: unknown }) => ({ runId: Number(d.runId) }))
	.handler(({ data }) => runLog(data.runId));

/**
 * 现在就跑一次解析或整理，立刻返回。
 *
 * **不等它跑完**：一轮是几分钟到几十分钟，而这是一次 HTTP 往返。进度会持续
 * 写进 `task_run` 那一行，页面重新载入状态就看得见。排着或在跑的已经有
 * 一个时返回 `queued: false`，界面照它说明原因——把这件事画成一个转不完的圈会误导人。
 */
export const requestTask = createServerFn({ method: "POST" })
	.middleware([administrator])
	.validator((kind: JobKind) => {
		if (kind !== "derive" && kind !== "review")
			throw new Error(`没有这种后台任务：${String(kind)}`);
		return kind;
	})
	.handler(
		async ({ data }): Promise<{ queued: boolean }> => ({
			queued: await requestJob(
				data === "derive" ? { kind: data, manual: true } : { kind: data },
			),
		}),
	);

/** 数据页的人员列表：按名字或工号找，一页一页地给。 */
export const dataList = createServerFn({ method: "GET" })
	.middleware([authenticated])
	.validator(tableQuery)
	.handler(({ data, context }) =>
		listEmployees({ account: context.viewer.id }, data.q, data.page),
	);

/** 数据页的一个人：档案、每一段、每一段的解析结果。 */
export const dataEmployee = createServerFn({ method: "GET" })
	.middleware([authenticated])
	.validator((d: { personId: unknown }) => ({
		personId: String(d.personId ?? ""),
	}))
	.handler(({ data, context }) =>
		viewed(context.viewer, data.personId, employeeData),
	);
