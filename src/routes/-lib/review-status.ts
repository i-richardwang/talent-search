import type { Judge } from "#/corpus/questions";

/**
 * 这句话需要的信息：谁在判，以及判卷归外部时接口有没有配置、队列里还有几道题
 * （`server/skills.ts` 取的那两个数）。归模型或已关闭时这两个字段没有用处。
 */
export type Reviewing =
	| { judge: "model" | "off" }
	| { judge: "external"; reachable: boolean; waiting: number };

/**
 * 把「整理当前由谁判」渲染成一句话。
 *
 * 两处读它：词表页顶部那一句（`routes/skills.tsx`），和任务台整理那张卡片
 * （`routes/tasks.tsx`）。同一个状态在两处各写一份文案的话，改一次必定漏掉一处，
 * 而表现是两页各说各的、两句都读得通，不会有人报这个问题。
 *
 * 归外部时带上待判题数：没有这个数，一个停止更新的词表和一个正常工作的词表在
 * 页面上完全一样。
 */
export function reviewStatus(state: Reviewing): string {
	if (state.judge === "external") {
		if (!state.reachable)
			return "判定交给外部工具，但接口没有配置凭据，外部工具接不上";
		return state.waiting > 0
			? `判定交给外部工具，还有 ${state.waiting} 组词等着判`
			: "判定交给外部工具，暂时没有等着判的词";
	}
	return state.judge === "off"
		? "自动整理已关闭，词表不再更新"
		: "由模型自动整理，每天一轮";
}

/** 按判卷是否归外部，把一份词表快照转成上面那个类型。 */
export function reviewingOf(table: {
	judge: Judge;
	reachable: boolean;
	waiting: number;
}): Reviewing {
	return table.judge === "external"
		? { judge: "external", reachable: table.reachable, waiting: table.waiting }
		: { judge: table.judge };
}
