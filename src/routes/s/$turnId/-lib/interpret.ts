import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { SearchSpec } from "#/search/spec";
import type { TraceStep } from "#/search/trace";
import { interpretTurn, turnTrace } from "#/server/functions";

/** 理解失败时说什么。和提交失败分开：一个是这句话没读懂，一个是没送出去。 */
const INTERPRET_FAILED = "没能整理出搜索条件，请重试或换一种说法。";

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
	error: string | null;
	retry: () => void;
	/** 到目前为止走过的步骤；理解落下后为 null，读记录上的那份。 */
	trace: TraceStep[] | null;
} {
	const router = useRouter();
	const [attempt, setAttempt] = useState(0);
	const [failedKey, setFailedKey] = useState<string | null>(null);
	const [trace, setTrace] = useState<TraceStep[] | null>(null);
	const key = `${turnId}#${attempt}`;

	useEffect(() => {
		if (settledSpec !== null) return;
		let alive = true;
		interpretTurn({ data: { turnId } })
			.then(async () => {
				if (!alive) return;
				await router.invalidate();
			})
			.catch(() => {
				if (alive) setFailedKey(key);
			});
		return () => {
			alive = false;
		};
	}, [settledSpec, turnId, key, router]);

	const failed = settledSpec === null && failedKey === key;
	const interpreting = settledSpec === null && !failed;

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
		error: failed ? INTERPRET_FAILED : null,
		retry: () => setAttempt((a) => a + 1),
		trace: interpreting || failed ? trace : null,
	};
}
