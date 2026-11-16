import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useRecents } from "#/routes/-lib/recents";
import { retryTurn, turnAttempt } from "#/server/functions";
import type { Attempt, AttemptFault, Progress, Turn } from "#/server/turn";
import { poll } from "./poll";

/**
 * AI 没处理成时各说什么。哪个环节出了问题由服务端判定（`server/turn.ts` 的 `processTurn`），
 * 这里只管文案：连不上、报错、没配时那句话没被读过，不说成没读懂，也不叫人换说法。
 * 屏幕上只说「AI 服务」。
 *
 * `title` 也写在线程那一轮底下和名单上方「名单可能不完整」的提示里，`hint` 只在名单那一列的
 * 空态里；
 * `retry` 给不给重试，`keyword` 给不给去关键词搜索（不经过模型，照样能用）。
 */
export const FAULT_COPY: Record<
	AttemptFault,
	{
		title: string;
		hint: string;
		retry: boolean;
		keyword: boolean;
	}
> = {
	unconfigured: {
		title: "AI 搜索还没开通",
		hint: "可以先用关键词搜索。",
		retry: false,
		keyword: true,
	},
	unreachable: {
		title: "AI 服务暂时连不上",
		hint: "这句需求已经记下，稍后点重试就行；着急的话可以先用关键词搜索。",
		retry: true,
		keyword: true,
	},
	rejected: {
		title: "AI 服务出了问题",
		hint: "这句需求已经记下，稍后点重试就行；一直不行请联系管理员。",
		retry: true,
		keyword: true,
	},
	unanswered: {
		title: "没能理解这段需求",
		hint: "重试一次，或者换个说法再说一遍。",
		retry: true,
		keyword: false,
	},
	broken: {
		title: "这次没有完成",
		hint: "多半是网络或服务器的临时问题，重试一下；一直不行请联系管理员。",
		retry: true,
		keyword: false,
	},
};

/** AI 没处理成时给的下一步，各自按钮上的字。 */
export const FAULT_EXIT_LABEL = {
	retry: "重试",
	keyword: "改用关键词搜索",
} as const;

type FaultExit = keyof typeof FAULT_EXIT_LABEL;

/** 这一环坏了给哪几条下一步，按按钮的先后；一条都没有是空表。 */
export function faultExits(fault: AttemptFault): FaultExit[] {
	const copy = FAULT_COPY[fault];
	return (["retry", "keyword"] as const).filter((exit) => copy[exit]);
}

/** 等 AI 时多久问一次走到哪一步了；一步是一次工具调用，秒级。 */
const PROGRESS_POLL_MS = 1000;

/**
 * AI 对链上最后一轮的处理，只读：理解一句话，或者 HR 直接改条件之后补上新进范围的人。处理在
 * 提交那一刻由服务端开始（`server/turn.ts`），这里不开始任何事：打开、刷新、多开几个标签页
 * 都只是多几个人在看。
 *
 * 还在处理时串行读取，相邻读取间隔一秒（`turnAttempt`）：线程边跑边画步骤，线程和名单
 * 从这一次开始的时刻计时；读到做完了就重新载入这一轮，读到失败就停下，等人点重试。
 */
export function useAttempt(latest: Turn): {
	/** AI 还在处理这一轮。 */
	working: boolean;
	fault: AttemptFault | null;
	retry: () => void;
	/** 这一次处理到目前为止的进度；做完后为 null，读记录上的那份。 */
	progress: Progress | null;
} {
	const router = useRouter();
	const { reload } = useRecents();
	const turnId = latest.id;
	const { settled } = latest;
	// 最近一次读到的这一轮；还没读过就是载入页面时记录上的那份
	const [read, setRead] = useState<{
		turnId: string;
		state: Attempt;
	} | null>(null);
	const state: Attempt =
		read?.turnId === turnId
			? read.state
			: {
					trace: latest.trace ?? [],
					startedAt: latest.startedAt,
					fault: latest.fault,
					settled,
				};
	const fault = settled ? null : state.fault;
	const working = !settled && fault === null;

	const show = useCallback(
		(next: Attempt | null) => {
			if (!next) return;
			if (next.settled) void router.invalidate();
			else setRead({ turnId, state: next });
		},
		[router, turnId],
	);

	useEffect(() => {
		if (!working) return;
		return poll(PROGRESS_POLL_MS, async (signal) => {
			const next = await turnAttempt({ data: { turnId }, signal });
			if (signal.aborted) return false;
			show(next);
			return !next?.settled && !next?.fault;
		});
	}, [working, turnId, show]);

	const retry = () =>
		retryTurn({ data: { turnId } })
			.then((next) => {
				show(next);
				// 最近搜索里这一行从没处理成变回还在处理
				void reload();
			})
			.catch(() => {
				// 连 RPC 都没走通：自家服务器这一侧的事
				setRead({ turnId, state: { ...state, fault: "broken" } });
			});

	return {
		working,
		fault,
		retry,
		progress: settled
			? null
			: { trace: state.trace, startedAt: state.startedAt },
	};
}
