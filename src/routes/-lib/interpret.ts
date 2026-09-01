import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Chip } from "#/search/parse";
import { interpretTurn } from "#/server/functions";

/** 理解失败时说什么。和提交失败分开：一个是这句话没读懂，一个是没送出去。 */
const INTERPRET_FAILED = "没能理解这句话，请重试或换一种说法。";

/**
 * 补上这条记录还欠的那一跳：把原话翻译成条件。
 *
 * 模型那一跳最长要 60 秒，不能挡在导航前面。提交只落一条记录（一次 INSERT），
 * 工作台立刻出现，理解在这里补——所以转圈发生在结果将要出现的地方，而不是发生在
 * 按钮上。写成 effect 而不是放进 loader 就是这个意思。
 *
 * 服务端那侧只补 `chips is null` 的行，所以重复触发（严格模式双次挂载、两个标签页
 * 开着同一条记录）都拿回同一份结果。
 *
 * @param settledChips 记录上已经理解好的条件；`null` 表示这一跳还欠着。
 */
export function useInterpretation(
	turnId: string,
	settledChips: Chip[] | null,
): { interpreting: boolean; error: string | null; retry: () => void } {
	const navigate = useNavigate();
	const router = useRouter();
	const [attempt, setAttempt] = useState(0);
	const [failedKey, setFailedKey] = useState<string | null>(null);
	const key = `${turnId}#${attempt}`;

	useEffect(() => {
		if (settledChips !== null) return;
		let alive = true;
		interpretTurn({ data: { turnId } })
			.then(({ filters }) => {
				if (!alive) return;
				/*
				 * 模型顺带认出来的筛选（只看入职前、公司档、最短时长）在这里
				 * **一次性播进 URL**，此后 URL 就是筛选的唯一事实源。不这样做的话，
				 * 它们既在记录上又在 URL 上：用户把「只看入职前」关掉，刷新一次
				 * 又自己回来了。
				 */
				if (Object.keys(filters).length > 0)
					navigate({
						to: ".",
						search: (o) => ({ ...o, ...filters }),
						replace: true,
					});
				else router.invalidate();
			})
			.catch(() => {
				if (alive) setFailedKey(key);
			});
		return () => {
			alive = false;
		};
	}, [settledChips, turnId, key, navigate, router]);

	const failed = settledChips === null && failedKey === key;
	return {
		interpreting: settledChips === null && !failed,
		error: failed ? INTERPRET_FAILED : null,
		retry: () => setAttempt((a) => a + 1),
	};
}
