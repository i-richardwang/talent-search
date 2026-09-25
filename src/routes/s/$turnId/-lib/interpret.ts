import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { SearchSpec } from "#/search/spec";
import type { TraceStep } from "#/search/trace";
import { interpretTurn, turnTrace } from "#/server/functions";
import type { InterpretFault } from "#/server/turn";

/**
 * 理解失败时各说什么。哪一环坏了由服务端判定（`server/turn.ts` 的 `interpret`），
 * 这里只管文案：连不上、报错、没配时那句话根本没被读过，不能说成它没读懂，
 * 也不能叫人去换说法——换了也一样。内部的环节名（端点、模型、日志）不上屏，
 * 用户认得的只有「AI 服务」。
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

/** 等理解时多久问一次走到哪一步了。一步是一次工具调用，秒级；再密只是白问。 */
const TRACE_POLL_MS = 1000;

/**
 * 补上这条记录还欠的那一跳：把原话翻译成条件。
 *
 * 模型那一跳最长要 60 秒，不能挡在导航前面。提交只落一条记录（一次 INSERT），
 * 工作台立刻出现，理解在这里补——所以转圈发生在结果将要出现的地方，而不是发生在
 * 按钮上。写成 effect 而不是放进 loader 就是这个意思。
 *
 * 服务端那侧只补 `spec is null` 的行，所以重复触发（严格模式双次挂载、两个标签页
 * 开着同一条记录）都拿回同一份结果。
 *
 * 等的时候每秒问一次走到哪一步了（`turnTrace`），交出 `trace` 给线程边跑边画：
 * 模型查了什么词、试搜出多少人，人在等的正是这些。理解落下之后 loader 的数据里
 * 有整份，这里就不再问。
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
