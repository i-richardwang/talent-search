/**
 * **改查询的唯一入口。** 界面上所有「让结果变一批人」的动作——首页敲一句话、
 * 在工作台里补充一句需求、改一个 chip 的强度、停用或删掉一个条件——最后都落到这里：
 * 落一条查询记录，然后导航到它。改筛选是重新看一遍同一批候选，走 `updateView`。
 *
 * 改查询一律 push：记录不可变，浏览器的后退键就是撤销，回到上一条记录。
 */
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { QueryInput } from "#/search/spec";
import { commitTurn } from "#/server/functions";

/** 落记录失败时说什么。区分不了原因，也不必区分：能做的只有重试。 */
export const COMMIT_FAILED = "没能提交这次搜索，请重试。";

export function useCommit() {
	const navigate = useNavigate();
	// 一次只能飞一条：两条同时在飞，先回来的会被后回来的覆盖。
	const inFlight = useRef(false);
	const [error, setError] = useState<string | null>(null);

	/**
	 * @param from 人正看着的那一轮：动作作用在它的条件上，新的一轮接在链尾
	 *   （`server/turn.ts` 的 `createTurn`）。首页没有，开一条新链。
	 * 新问题从默认视图开始；上一条记录的 URL 状态不属于查询语义，不能跟着复制。
	 * @returns 成功与否。输入框据此决定要不要清空，失败时留着人刚敲的话好重试。
	 */
	const commit = async (input: QueryInput, opts: { from?: string } = {}) => {
		if (inFlight.current) return false;
		inFlight.current = true;
		setError(null);
		try {
			const { turnId } = await commitTurn({
				data: { from: opts.from, input },
			});
			await navigate({
				to: "/s/$turnId",
				params: { turnId },
				search: {},
			});
			return true;
		} catch {
			// 网络断了、服务端或库出错：不说的话转圈停了、什么都没发生
			setError(COMMIT_FAILED);
			return false;
		} finally {
			inFlight.current = false;
		}
	};

	return { error, commit };
}
