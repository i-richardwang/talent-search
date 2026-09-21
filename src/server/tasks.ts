/**
 * 语料侧一次任务的生命周期：谁能开始、说过的话去哪、上一次是什么结果。
 *
 * 三种任务（`TASK_KINDS`）走同一条锁、同一张记录、同一个 `runTask`：同步是
 * `bun run sync` 跑的脚本，派生和整理是应用进程里的后台任务（`jobs.ts`）。
 * 各自做什么在 `src/corpus/` 下的同名模块里，这里只管边界上的四件事：
 *
 * 1. **写者一次只有一个**（`corpus/session.ts`）。后台任务拿不到锁就当场放弃，
 *    它反正还会再来；命令行的同步排队等。
 * 2. **活性问锁，历史问表。** 一行记录说的是「这一次发生过什么」；「此刻有没有人
 *    在跑」是连接的属性，由 `corpusSessionActive()` 去问 Postgres。两件事各有各的
 *    出处，于是没有一个要靠人来对齐的中间状态，也不需要「下一次开始时先给上一次
 *    收尾」那样的修补步骤——进程中断的那一行，此刻就看得出它是中断的。
 *    这要求**行写完才放锁**：锁在手里的时候行还没写完，读者只会读成「正在跑」；
 *    反过来先放锁，就会有一瞬间「没人持锁、行没写完」，读起来和进程中断一模一样。
 * 3. **说过的每一行都进那一行记录。** 攒着批量写，不是一行一次往返——整理能力词
 *    一轮能说出上千行。记录是关于这次运行的，不是它的前提：一批日志没能落库，
 *    去标准错误说一声，任务照跑，结果照写。
 * 4. **失败写进记录，不只是抛给调用方。** 看任务台的人看不到服务器的标准输出，
 *    所以那条记录必须自己说得出为什么停了。
 */

import "@tanstack/react-start/server-only";
import { eq, sql } from "drizzle-orm";
import { currentTree, derive, identity, pending } from "#/corpus/derive";
import { glossCounts } from "#/corpus/gloss";
import type { Judge } from "#/corpus/judgment";
import type { Report } from "#/corpus/report";
import { review } from "#/corpus/review";
import {
	acquireCorpusSession,
	type CorpusSession,
	corpusSessionActive,
} from "#/corpus/session";
import { type SourceConfig, sourceConfig } from "#/corpus/sources";
import { sync } from "#/corpus/sync";
import { db, pool } from "#/db";
import { TASK_KINDS, type TaskKind, taskRun } from "#/db/schema";
import { pageAt } from "./paging";
import { configured, reviewJudge } from "./review";

/** 运行记录一页几行。往前的那些翻页看（`/tasks?derive=3`）。 */
const RUNS_PAGE = 6;

/** 攒多久写一次日志。够短，页面上看着是在动的；够长，上千行不变成上千次往返。 */
const FLUSH_MS = 400;

/** 一行记录里最多展开几层来由。有环的错误链也就到此为止。 */
const CAUSE_DEPTH = 5;

/**
 * 一轮派生最多跑多久。到点就放锁退出，下一轮接着：同步在排队的话能插进来，
 * 一轮的记录也不至于长到没法看。
 */
const DERIVE_BUDGET_MS = 10 * 60_000;

/** 任务本身：拿着写者连接干活，过程交给 `report`。 */
type TaskWork = (
	session: CorpusSession,
	report: Report,
	source: SourceConfig | null,
) => Promise<void>;

/** 三种任务各自做什么。各自的道理在 `src/corpus/` 下的同名模块里。 */
const WORK: Record<TaskKind, TaskWork> = {
	sync: (session, report, source) => {
		if (!source) throw new Error("同步任务缺少数据源配置");
		return sync(session, source, report);
	},
	derive: async (session, report) => {
		await derive(session, report, DERIVE_BUDGET_MS);
	},
	review: async (session, report) => {
		const judge = reviewJudge();
		if (judge === "off") return;
		await review(session.client, report, judge);
		// 判定归外部却没配凭据，接口是关着的，组会挂到过期。这是配错了，得在记录里
		// 说出来：整理一轮轮照跑、词表一动不动，没有这句没人看得出为什么
		if (judge === "external" && !configured())
			report("  ✖ 判定归外部，但 REVIEW_TOKEN 没配，接口关着，没人能提交判定");
	},
};

/**
 * 一次运行的四种样子。
 *
 * 「中断」不是事后补写进库的一句话，是当场看出来的：这一行没写完，而锁没人拿着。
 */
export type TaskOutcome = "running" | "interrupted" | "failed" | "done";

/**
 * 一次运行在页面上的样子。
 *
 * 时刻和用时**在库里算好**：服务端直出和浏览器水合各算一次的话，两边的时区
 * 不同就会渲染出两个不一样的字符串，而 React 只会在控制台嘀咕一句。
 * 管理页 `/skills` 的「几天前」是同一个道理。
 */
export type TaskRunView = {
	id: number;
	kind: TaskKind;
	/** 同步读的是哪个适配器；其余两种是空串 */
	source: string;
	/** 开始时刻，`MM-DD HH:MM` */
	startedAt: string;
	/** 用时秒数；还在跑和中断的那一行没有用时 */
	seconds: number | null;
	error: string | null;
	outcome: TaskOutcome;
};

/**
 * 一种任务在任务台上的一栏：它跑过的记录里的一页，最新的一次在最前面。
 *
 * 给的是一页，连同这一栏一共几页、一共跑过几次：跑过几百次的一栏也要能一直往前
 * 翻到头（`/data` 同一条规矩）。
 *
 * 不带日志。一轮整理能说上千行，而任务台正在跑的时候每两秒重新载入一次——
 * 日志按需单取（`taskLog`），页面上也只在打开某一次的日志时才用得到。
 */
export type TaskLane = {
	kind: TaskKind;
	/** 要的那一页，最新的一次在最前面 */
	runs: TaskRunView[];
	/**
	 * 这一栏最近的那一次，不随翻到第几页变。
	 *
	 * 卡片正面说的是「这一栏此刻怎么样」，那永远是最近这一次；翻到第三页的时候
	 * 拿那一页的第一行来说，卡片就会报一个几天前的结果当现状。
	 */
	latest: TaskRunView | null;
	/** 这一栏一共跑过几次 */
	total: number;
	/**
	 * 给出的是第几页，从 1 起。
	 *
	 * 页码由这里定夺，不是照抄地址栏里的那个数：越界收回最后一页，否则翻过头
	 * 就是一张空表（`listEmployees` 同一条规矩）。
	 */
	page: number;
	/** 一共几页，至少一页 */
	pages: number;
};

/** 每一栏要看第几页。没说的那一栏是第一页。 */
export type TaskPages = Partial<Record<TaskKind, number>>;

/**
 * 语料此刻有多少东西。任务台三张卡片上的数全是它——**问库，不问上一次跑的记录**。
 *
 * 一次运行说过的「人群 20 人」是那一刻的快照，跑完就开始过期：下一次同步之后，
 * 卡片还显示上一次记录里的数字，就成了屏幕上一个没人维护的旧值。这些数库里现成有，
 * 每次载入查一遍即可（都是主键或小表上的 count，不值得为它们再开一份存储）。
 */
export type CorpusCounts = {
	/** 库里多少人 */
	employees: number;
	/** 段：公司内、入职前，以及两者之和 */
	internal: number;
	external: number;
	segments: number;
	/** 还不是当前派生版本的段数 */
	pending: number;
	/** 说法条数 */
	phrases: number;
	/** 能力词个数，以及其中已经并到别的写法上的 */
	words: number;
	merged: number;
	/** 该有释义的短说法条数，以及其中已经写了的 */
	glossable: number;
	glossed: number;
};

/** 任务台一次载入要的全部。 */
type TasksState = {
	lanes: TaskLane[];
	corpus: CorpusCounts;
	/**
	 * 此刻有没有人在跑（问锁，见文件头第 2 条）。页面照它决定轮询快慢，以及
	 * 「立即运行」能不能按——跑着的时候按下去只会被回绝。
	 */
	running: boolean;
	/**
	 * 整理此刻谁在判（`src/corpus/vocabulary.ts`）。任务台要它是因为 `off` 的时候
	 * 后台那一轮直接返回（`jobs.ts`），「现在跑一次」按下去什么都不会发生——
	 * 按钮得先知道这件事，才不至于画成一个按了没反应的按钮。
	 */
	judge: Judge;
};

type StoredRun = Omit<TaskRunView, "outcome">;

/**
 * 一行记录现在算哪一种。
 *
 * `live` 只对**最近**那一行成立：锁至多有一个持有者，而它开跑时落下的正是最新的
 * 一行，所以更早的那些没写完的行必然是中断留下的。
 */
function outcome(run: StoredRun, live: boolean): TaskOutcome {
	if (run.seconds !== null) return run.error ? "failed" : "done";
	return live ? "running" : "interrupted";
}

type TaskHead = StoredRun & { total: number };

async function readTaskHeads(): Promise<{
	active: boolean;
	heads: TaskHead[];
	signature: string;
} | null> {
	const before = await corpusSessionActive();
	const { rows: heads } = await db.execute<TaskHead>(sql`
		select distinct on (kind)
			kind, id, source,
			to_char(started_at, 'MM-DD HH24:MI') as "startedAt",
			extract(epoch from (finished_at - started_at))::int as seconds,
			error,
			count(*) over (partition by kind)::int as total
		from task_run
		order by kind, started_at desc, id desc`);
	const active = await corpusSessionActive();
	if (before !== active) return null;
	return {
		active,
		heads,
		signature: JSON.stringify([
			active,
			heads.map((row) => [row.kind, row.id, row.seconds, row.error, row.total]),
		]),
	};
}

/** 锁与运行行连续两次给出同一幅图，才把它当作当前状态。 */
async function stableTaskHeads(): Promise<{
	active: boolean;
	heads: TaskHead[];
}> {
	let previous: string | null = null;
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const sample = await readTaskHeads();
		if (!sample) {
			previous = null;
			continue;
		}
		if (sample.signature === previous)
			return { active: sample.active, heads: sample.heads };
		previous = sample.signature;
	}
	throw new Error("任务状态正在连续切换，请重新载入");
}

export async function tasksState(want: TaskPages = {}): Promise<TasksState> {
	/*
	 * 锁与行不是同一份 MVCC 快照：任务会先拿锁再插运行行，结束时先写完行再放锁。
	 * 因此只读一次无论先读谁都有缝。连续两次稳定观测把两个过渡区都排除在结果外。
	 */
	const { active, heads } = await stableTaskHeads();
	// 锁一次只有一个持有者，它开跑时落下的是全表最新的那一行
	const newest = Math.max(0, ...heads.map((row) => row.id));
	/** 库里那一行在页面上的样子。逐个字段写出来，行上别的列不跟着发到页面。 */
	const seen = (row: StoredRun): TaskRunView => ({
		error: row.error,
		id: row.id,
		kind: row.kind,
		outcome: outcome(row, active && row.id === newest),
		seconds: row.seconds,
		source: row.source,
		startedAt: row.startedAt,
	});
	const lanes = TASK_KINDS.map((kind) => {
		const head = heads.find((row) => row.kind === kind);
		const total = head?.total ?? 0;
		// 第几页、跳过多少行由 `pageAt` 定夺，三张管理页的表同一套算术
		const at = pageAt(total, want[kind], RUNS_PAGE);
		return {
			kind,
			latest: head ? seen(head) : null,
			page: at.page,
			pages: at.pages,
			total,
		};
	});
	/* 每一栏要的那一页。哪几行算这一页只在这条查询里说一次。 */
	const { rows } = await db.execute<StoredRun>(sql`
		select recent.id, recent.kind, recent.source,
			to_char(recent.started_at, 'MM-DD HH24:MI') as "startedAt",
			extract(epoch from (recent.finished_at - recent.started_at))::int as seconds,
			recent.error
		from (
			select *, row_number() over (partition by kind order by started_at desc, id desc) as n
			from task_run
		) recent
		join unnest(${sql.param(lanes.map((lane) => lane.kind))}::text[], ${sql.param(
			lanes.map((lane) => (lane.page - 1) * RUNS_PAGE),
		)}::int[]) as want(kind, skip) on want.kind = recent.kind
		where recent.n > want.skip and recent.n <= want.skip + ${RUNS_PAGE}
		order by recent.started_at desc, recent.id desc`);

	return {
		corpus: await corpusCounts(),
		judge: reviewJudge(),
		lanes: lanes.map((lane) => ({
			...lane,
			runs: rows.filter((row) => row.kind === lane.kind).map(seen),
		})),
		running: active,
	};
}

/**
 * 语料此刻的几个数，一趟问完。
 *
 * 「技能」数的是边上 `route = 'skill'` 那一类指到的说法，也就是人身上此刻有的词；
 * 「已经并到别的写法上」数的是词表里指向别人的那些词。
 */
async function corpusCounts(): Promise<CorpusCounts> {
	const [pending, gloss, counted] = await Promise.all([
		derivePending(),
		glossCounts(pool),
		pool.query<Record<string, string>>(
			`select
				(select count(*) from employee) as employees,
				(select count(*) from experience where kind = 'internal') as internal,
				(select count(*) from experience where kind = 'external') as external,
				(select count(*) from phrase) as phrases,
				(select count(distinct phrase_id) from experience_phrase
					where route = 'skill') as words,
				(select count(*) from skill_term where canonical <> word) as merged`,
		),
	]);
	const row = counted.rows[0];
	const n = (name: string) => Number(row?.[name] ?? 0);
	const internal = n("internal");
	const external = n("external");
	return {
		employees: n("employees"),
		external,
		glossable: gloss.glossable,
		glossed: gloss.glossed,
		internal,
		merged: n("merged"),
		pending,
		phrases: n("phrases"),
		segments: internal + external,
		words: n("words"),
	};
}

/**
 * 一次运行说过的每一行。
 *
 * 单取，不跟着任务台的状态一起来：这些行是排查时才看的东西，而一轮整理能说
 * 上千行，挂在每两秒一次的轮询上就是每两秒搬一遍。
 */
export async function taskLog(runId: number): Promise<string[]> {
	const { rows } = await db.execute<{ log: string[] }>(
		sql`select log from task_run where id = ${runId}`,
	);
	return rows[0]?.log ?? [];
}

/** 还不是当前派生版本的段数。后台任务用它决定这一轮有没有活，任务台用它画进度。 */
export async function derivePending(): Promise<number> {
	return pending(pool, identity(await currentTree(pool)));
}

/**
 * 把说出来的话攒进那一行记录。
 *
 * 每行一次 UPDATE 会让整理能力词那一段变成上千次往返；攒着写，并且**同一时刻只有
 * 一次在途的追加**——上一次还没落库时新来的行排在它后面，不并发改同一行。
 */
function logger(runId: number) {
	let pending: string[] = [];
	let writing: Promise<void> = Promise.resolve();
	let timer: ReturnType<typeof setTimeout> | null = null;

	const flush = (): Promise<void> => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (pending.length === 0) return writing;
		const lines = pending;
		pending = [];
		writing = writing
			.then(async () => {
				await db
					.update(taskRun)
					/*
					 * `sql.param` 把这一批行当**一个**数组参数送出去。直接内插的话
					 * 模板会把数组摊成一串参数，拼出来是 `($1, $2)` 一个记录，
					 * 而记录转不成 text[]——这条错只在多行一起落库时才出现。
					 */
					.set({ log: sql`${taskRun.log} || ${sql.param(lines)}::text[]` })
					.where(eq(taskRun.id, runId));
			})
			/*
			 * 这一批没落下去，下一批照追：链上不留一个拒绝的 promise，否则后面每一批
			 * 都跟着拒绝，定时器那条路上还没人接它。丢掉的行只剩标准错误这一处。
			 */
			.catch((error) => {
				console.error(
					`任务 ${runId} 的 ${lines.length} 行日志没能落库：`,
					error,
				);
			});
		return writing;
	};

	const report: Report = (line) => {
		pending.push(line);
		if (!timer) timer = setTimeout(flush, FLUSH_MS);
	};

	return { report, flush };
}

/**
 * 一条错误连同它的来由，外层在前。
 *
 * 只取最外层那一句会把真正发生的事丢掉：加载数据源失败时，外层说的是「读取数据源
 * company-adapter 失败」，而 `cause` 上挂着的才是具体的模块加载错误。
 */
function causeChain(error: unknown): string[] {
	const lines: string[] = [];
	let current = error;
	while (
		current !== null &&
		current !== undefined &&
		lines.length < CAUSE_DEPTH
	) {
		lines.push(current instanceof Error ? current.message : String(current));
		current = current instanceof Error ? current.cause : undefined;
	}
	return lines.length ? lines : [String(error)];
}

/** 一次跑完的任务。`failure` 是那一行上的失败原因，成功是 null。 */
type TaskResult = { runId: number; failure: string | null };

/**
 * 跑一次任务，跑完才返回。已经有写者在跑时：`wait` 为 false 返回 `null`，
 * 为 true 排队等。
 *
 * **它不抛。** 任务本身失败，结果是那一行上的一句话，也作为返回值交给调用方；
 * 连记录这件事本身都失败时（库没了），唯一还能说话的地方是标准错误。
 * 过程同时回显到 `echo`（命令行给标准输出，后台任务不给）。
 */
export async function runTask(
	kind: TaskKind,
	options: { wait?: boolean; echo?: Report } = {},
): Promise<TaskResult | null> {
	const session = await acquireCorpusSession(options.wait ?? false);
	if (!session) return null;
	const source = kind === "sync" ? sourceConfig() : null;

	let runId: number;
	try {
		const [row] = await db
			.insert(taskRun)
			.values({ kind, source: source?.name ?? "", log: [] })
			.returning({ id: taskRun.id });
		if (!row) throw new Error("没能落下这次任务的记录");
		runId = row.id;
	} catch (error) {
		await session.release();
		throw error;
	}

	const { report, flush } = logger(runId);
	const say: Report = (line) => {
		options.echo?.(line);
		report(line);
	};

	let failure: string | null = null;
	try {
		try {
			await WORK[kind](session, say, source);
		} catch (error) {
			const chain = causeChain(error);
			failure = chain[0] ?? String(error);
			// 来由逐层进日志：一句话装不下的诊断，本来就该是多行
			for (const [depth, line] of chain.entries())
				say(depth === 0 ? `✖ ${line}` : `  ${"  ".repeat(depth)}↳ ${line}`);
		}
		await flush();
		await db
			.update(taskRun)
			.set({ finishedAt: new Date(), error: failure })
			.where(eq(taskRun.id, runId));
	} catch (error) {
		console.error(`任务 ${runId} 的记录没能收尾：`, error);
		failure ??= causeChain(error)[0] ?? String(error);
	} finally {
		// 行写完才放锁（见文件头第 2 条）；行的更新走连接池，不依赖这条会话
		await session.release();
	}
	return { runId, failure };
}
