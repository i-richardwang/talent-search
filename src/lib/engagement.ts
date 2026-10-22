/**
 * 投入多深：这个人在一段经历里对一项能力自己做了什么。抽取按原文判断；
 * 模型没给出合法档时是 null。顺序从深到浅，证据行和员工详情按这个顺序显示。
 */
export const ENGAGEMENTS = ["主导", "做过", "提到"] as const;

export type Engagement = (typeof ENGAGEMENTS)[number];

export function isEngagement(value: unknown): value is Engagement {
	return ENGAGEMENTS.includes(value as Engagement);
}
