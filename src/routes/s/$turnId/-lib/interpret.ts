import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { retryTurn, turnInterpretation } from "#/server/functions";
import type {
	Interpretation,
	InterpretFault,
	Progress,
	Turn,
} from "#/server/turn";

/**
 * 理解失败时各说什么。哪个环节出了问题由服务端判定（`server/turn.ts` 的 `interpret`），
 * 这里只管文案：连不上、报错、没配时那句话没被读过，不说成没读懂，也不叫人换说法。
 * 屏幕上只说「AI 服务」。
 *
 * `title` 也记在线程那一轮底下，`hint` 只在名单那一列的空态里；
 * `retry` 给不给重试，`keyword` 给不给去关键词搜索（不经过模型，照样能用）。
 */
export const FAULT_COPY: Record<
	InterpretFault,
	{
		title: string;
		hint: string;
		retry: boolean;
		keyword: boolean;
	}
> = {
	unconfigured: {
		title: "AI 搜索未开启",
		hint: "请使用关键词搜索。",
		retry: false,
		keyword: true,
	},
	unreachable: {
		title: "AI 服务暂时不可用",
		hint: "你的描述没有问题。请稍后重试，或先使用关键词搜索。",
		retry: true,
		keyword: true,
	},
	rejected: {
		title: "AI 服务出错",
		hint: "你的描述没有问题。请稍后重试；如果持续出现，请联系管理员。",
		retry: true,
		keyword: true,
	},
	unanswered: {
		title: "没能理解这段需求",
		hint: "请重试，或换一种说法。",
		retry: true,
		keyword: false,
	},
	broken: {
		title: "出错了",
		hint: "请重试。",
		retry: true,
		keyword: false,
	},
};

/** 理解失败时名单那一列给的下一步，各自按钮上的字。 */
export const FAULT_EXIT_LABEL = {
	retry: "重试",
	keyword: "改用关键词搜索",
} as const;

type FaultExit = keyof typeof FAULT_EXIT_LABEL;

/** 这一环坏了给哪几条下一步，按按钮的先后；一条都没有是空表。 */
export function faultExits(fault: InterpretFault): FaultExit[] {
	const copy = FAULT_COPY[fault];
	return (["retry", "keyword"] as const).filter((exit) => copy[exit]);
}

/** 等理解时多久问一次走到哪一步了；一步是一次工具调用，秒级。 */
const PROGRESS_POLL_MS = 1000;

/**
 * 链上最后一轮的理解，只读。理解在提交那一刻由服务端开始（`server/turn.ts`），
 * 这里不开始任何事：打开、刷新、多开几个标签页都只是多几个人在看。
 *
 * 还在理解时每秒读一次（`turnInterpretation`）：线程边跑边画步骤，线程和名单从这一次
 * 开始的时刻计时；读到条件写好了就重新载入这一轮，读到失败就停下，等人点重试。
 */
export function useInterpretation(latest: Turn): {
	interpreting: boolean;
	fault: InterpretFault | null;
	retry: () => void;
	/** 这一次理解到目前为止的进度；理解完成后为 null，读记录上的那份。 */
	progress: Progress | null;
} {
	const router = useRouter();
	const turnId = latest.id;
	const settled = latest.spec !== null;
	// 最近一次读到的这一轮；还没读过就是载入页面时记录上的那份
	const [read, setRead] = useState<{
		turnId: string;
		state: Interpretation;
	} | null>(null);
	const state: Interpretation =
		read?.turnId === turnId
			? read.state
			: {
					trace: latest.trace ?? [],
					startedAt: latest.startedAt,
					fault: latest.fault,
					settled,
				};
	const fault = settled ? null : state.fault;
	const interpreting = !settled && fault === null;

	const show = useCallback(
		(next: Interpretation | null) => {
			if (!next) return;
			if (next.settled) void router.invalidate();
			else setRead({ turnId, state: next });
		},
		[router, turnId],
	);

	useEffect(() => {
		if (!interpreting) return;
		let alive = true;
		const timer = setInterval(async () => {
			try {
				const next = await turnInterpretation({ data: { turnId } });
				if (!alive) return;
				// 写好了就不再问：重新载入这一轮要一会儿，不必每秒再催一次
				if (next?.settled) clearInterval(timer);
				show(next);
			} catch {
				// 问不到就下一秒再问：这只是进度，理解不靠它
			}
		}, PROGRESS_POLL_MS);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, [interpreting, turnId, show]);

	const retry = () => {
		retryTurn({ data: { turnId } })
			.then(show)
			.catch(() => {
				// 连 RPC 都没走通：自家服务器这一侧的事
				setRead({ turnId, state: { ...state, fault: "broken" } });
			});
	};

	return {
		interpreting,
		fault,
		retry,
		progress: settled
			? null
			: { trace: state.trace, startedAt: state.startedAt },
	};
}
