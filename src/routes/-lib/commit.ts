/**
 * **改查询的唯一入口。** 界面上所有「让结果变一批人」的动作——零态敲一句话、
 * 在工作台里改写那句话、改一枚 chip 的强度、停用或删掉一个条件、改范围、
 * 重新理解——最后都落到这里：落一条查询记录，然后导航到它。
 *
 * 它和改筛选的 `updateView` 是两个函数，因为它们是两件事：改筛选是重新看一遍
 * 同一批候选，改查询是换一个问题。合成一个之后这两者在代码里就长得一模一样了。
 * 分开的结果是「查询」这一侧每一次变化都留下一条可回溯的记录，
 * 「视图」那一侧照旧只是几个 URL 参数。
 *
 * **改查询一律 push，不 replace。** 于是浏览器的后退键就是撤销：把一枚 chip
 * 从「必须」改成「加分」之后想反悔，按一下后退回到上一条记录。这不是附带
 * 效果，是记录不可变换来的——上一步的样子还完整地在库里。
 */
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { QueryInput } from "#/search/spec";
import { commitTurn } from "#/server/functions";

/** 落记录失败时说什么。区分不了原因，也不必区分：能做的只有重试。 */
const FAILED = "没能提交这次搜索，请重试。";

export function useCommit() {
	const navigate = useNavigate();
	// 一次只许飞一条：两条同时在飞，先回来的会被后回来的覆盖。
	const inFlight = useRef(false);
	const [error, setError] = useState<string | null>(null);

	/**
	 * @param parentTurnId 从哪一条派生。工作台里的改动都有父记录，零态没有。
	 * 新问题从默认视图开始；上一条记录的 URL 状态不属于查询语义，不能跟着复制。
	 * @returns 成功与否。零态的输入框据此决定要不要清空——这一步会失败，
	 *   失败了还把人刚敲的话吞掉，就连重试都没得重试。
	 */
	const commit = async (
		input: QueryInput,
		opts: { parentTurnId?: string } = {},
	) => {
		if (inFlight.current) return false;
		inFlight.current = true;
		setError(null);
		try {
			const { turnId } = await commitTurn({
				data: {
					parentTurnId: opts.parentTurnId,
					input,
				},
			});
			await navigate({
				to: "/s/$turnId",
				params: { turnId },
				search: {},
			});
			return true;
		} catch {
			/*
			 * 这一跳会失败：网络断了、服务端挂了、库连不上。「查询理解不会抛」
			 * 只覆盖模型那一段，覆盖不了这条链路本身。不接住的话，失败的表现是
			 * 转圈停了、什么都没发生，人只会再点一次。
			 */
			setError(FAILED);
			return false;
		} finally {
			inFlight.current = false;
		}
	};

	return { error, commit };
}
