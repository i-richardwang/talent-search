export const INVOLVEMENT_GUIDE = {
	从零搭建: "从无到有做出来的",
	负责建设: "主责、主导、负责的",
	优化改进: "提升、改造、迭代已有东西的",
	参与执行: "参与、协助、配合、支持的",
	带队管理: "带团队、管理人的",
} as const;

export type Involvement = keyof typeof INVOLVEMENT_GUIDE;

export const INVOLVEMENTS = Object.keys(INVOLVEMENT_GUIDE) as Involvement[];

export function isInvolvement(value: string): value is Involvement {
	return Object.hasOwn(INVOLVEMENT_GUIDE, value);
}

export function involvementRank(value: string | null): number {
	if (value === null || !isInvolvement(value)) return INVOLVEMENTS.length;
	return INVOLVEMENTS.indexOf(value);
}
