import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { SearchSpec } from "#/search/spec";
import type { TraceStep } from "#/search/trace";
import { interpretTurn, turnTrace } from "#/server/functions";
import type { InterpretFault } from "#/server/turn";

/**
 * 理解失败时各说什么。哪一环坏了由服务端判定（`server/turn.ts` 的 `interpret`），
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

/** 理解失败时名单那一列给的出路，各自按钮上的字。 */
export const FAULT_EXIT_LABEL = {
	retry: "重试",
	keyword: "改用关键词搜索",
} as const;

export type FaultExit = keyof typeof FAULT_EXIT_LABEL;

/** 这一环坏了给哪几条出路，按按钮的先后；一条都没有是空表。 */
export function faultExits(fault: InterpretFault): FaultExit[] {
	const copy = FAULT_COPY[fault];
	return (["retry", "keyword"] as const).filter((exit) => copy[exit]);
}

/** 等理解时多久问一次走到哪一步了；一步是一次工具调用，秒级。 */
const TRACE_POLL_MS = 1000;

/**
 * 补上这条记录还欠的那一跳：把原话翻译成条件。提交只落一条记录、立刻进工作台，
 * 理解在这里的 effect 里补，等待显示在名单那一列。
 *
 * 服务端只补 `spec is null` 的行，重复触发拿回同一份结果。等的时候每秒问一次走到
 * 哪一步了（`turnTrace`），交出 `trace` 给线程边跑边画；理解落下后不再问。
 *
 * @param settledSpec 记录上已经理解好的完整查询；`null` 表示这一跳还欠着。
 */
export function useInterpretation(
	turnId: string,
	settledSpec: SearchSpec | null,
): {
	interpreting: boolean;
	/** 没理解出来时是哪一环坏了。 */
	fault: InterpretFault | null;
	retry: () => void;
	/** 到目前为止走过的步骤；理解落下后为 null，读记录上的那份。 */
	trace: TraceStep[] | null;
} {
	const router = useRouter();
	const [attempt, setAttempt] = useState(0);
	const [failed, setFailed] = useState<{
		key: string;
		fault: InterpretFault;
	} | null>(null);
	const [trace, setTrace] = useState<TraceStep[] | null>(null);
	const key = `${turnId}#${attempt}`;

	useEffect(() => {
		if (settledSpec !== null) return;
		let alive = true;
		interpretTurn({ data: { turnId } })
			.then(async ({ fault }) => {
				if (!alive) return;
				if (fault) setFailed({ key, fault });
				else await router.invalidate();
			})
			.catch(() => {
				// 连 RPC 本身都没走通：自家服务器这一侧的事
				if (alive) setFailed({ key, fault: "broken" });
			});
		return () => {
			alive = false;
		};
	}, [settledSpec, turnId, key, router]);

	const fault =
		settledSpec === null && failed?.key === key ? failed.fault : null;
	const interpreting = settledSpec === null && fault === null;

	useEffect(() => {
		if (!interpreting) return;
		let alive = true;
		setTrace([]);
		const ask = async () => {
			try {
				const now = await turnTrace({ data: { turnId } });
				if (alive && now) setTrace(now.trace);
			} catch {
				// 问不到就下一秒再问：这只是进度，理解本身不靠它
			}
		};
		const timer = setInterval(ask, TRACE_POLL_MS);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, [interpreting, turnId]);

	return {
		interpreting,
		fault,
		retry: () => setAttempt((a) => a + 1),
		trace: interpreting || fault ? trace : null,
	};
}
