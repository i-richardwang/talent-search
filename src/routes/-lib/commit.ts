/**
 * **改查询的唯一入口。** 界面上所有「让结果变一批人」的动作——零态敲一句话、
 * 点一个词汇、在工作台里加条件、改一枚 chip 的强度、删掉一个条件——最后都
 * 落到这里：落一条查询记录，然后导航到它。
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
import { useState } from "react";
import { type QueryInput, toQuery } from "#/search/parse";
import { commitTurn } from "#/server/functions";
import type { View } from "./view-params";

/** 落记录失败时说什么。区分不了原因，也不必区分：能做的只有重试。 */
const FAILED = "没能提交这次搜索，请重试。";

export function useCommit() {
	const navigate = useNavigate();
	/**
	 * **正在飞的那一条**，不是一个布尔：零态那排示例要靠它认出该转圈的是哪一条，
	 * 也要靠它把其余几条禁掉——两条同时在飞，先回来的会被后回来的覆盖。
	 */
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	/**
	 * @param parentTurnId 从哪一条派生。工作台里的改动都有父记录，零态没有。
	 * @param view 带过去的视图状态。改查询时筛选留着（还在看同一类人），
	 *   但翻页数不留：换了问题还拉 150 人回来，比第一次检索慢三倍，
	 *   而人根本没要求看那么多。
	 * @returns 成功与否。零态的输入框据此决定要不要清空——这一步会失败，
	 *   失败了还把人刚敲的话吞掉，就连重试都没得重试。
	 */
	const commit = async (
		input: QueryInput,
		opts: { parentTurnId?: string; view?: View } = {},
	) => {
		const key = input.kind === "sentence" ? input.text : toQuery(input.chips);
		if (pending !== null) return false;
		setPending(key);
		setError(null);
		try {
			const { turnId } = await commitTurn({
				data: { parentTurnId: opts.parentTurnId, input },
			});
			await navigate({
				to: "/s/$turnId",
				params: { turnId },
				search: { ...opts.view, n: undefined },
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
			setPending(null);
		}
	};

	return { pending, error, commit };
}
