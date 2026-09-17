/**
 * 并列的几样拼成一行：空的那几样不占位。
 *
 * ` · ` 是全站唯一的并列分隔符——序列三级、部门与职位、学历与学校、公司标签、
 * 历史记录里的条件，读起来都是「这几样并排」这一件事，各处再各挑一个符号
 * （`/`、`,`、`|`）只会让人以为那是几种不同的关系。
 *
 * 过滤空值是规则的一部分，不是防御：这些字段大量地本来就没有（外部经历没有
 * 序列三级，很多人没有职级），把空的留下就会得到 ` ·  · ` 这种悬空的点。
 */
export function dots(...parts: (string | null | undefined)[]) {
	return parts.filter(Boolean).join(" · ");
}

/**
 * 一个人现在在哪儿：部门 · 职位 · 职级。
 *
 * 名单卡片和详情面板的抬头说的是同一句话，而它们是这个人在两块屏幕上的同一个
 * 身份——两处各拼一遍的话，哪天决定把职级去掉，改一处忘一处的表现是同一个人
 * 在两块屏幕上写着不一样的头衔。
 */
export function positionLabel(e: {
	curDept: string;
	curTitle: string;
	curLevel: string;
}) {
	return dots(e.curDept, e.curTitle, e.curLevel);
}

/** 起止：2021-03 – 2024-10 / 2021-03 – 至今 */
export function period(start: string, end: string | null) {
	return `${start.slice(0, 7)} – ${end ? end.slice(0, 7) : "至今"}`;
}

/** 时长：11 个月 / 2 年 / 2 年 3 个月。详情面板和时间轴用它，那里要的是准确。 */
export function duration(months: number) {
	if (months < 12) return `${months} 个月`;
	const y = Math.floor(months / 12);
	const m = months % 12;
	return m ? `${y} 年 ${m} 个月` : `${y} 年`;
}

/**
 * 证据行右端的时长：折成年，**恒定占三个数位槽**。
 *
 * 那一端要的不是精确，是**能上下比长短**：五十个人的同一个条件竖着排在一列，
 * 眼睛扫的是「谁干得久」。「2 年 3 个月」宽度随月份变，配上「前 」之后每一行
 * 的右端都在不同位置，那一列就没法当数读了。折成年之后配 tabular-nums
 * 宽度恒定，右端对齐成一条线。精确到月的那一份在 title 和详情面板里，一个都没丢。
 *
 * 十年以上丢掉小数位（`12 年` 而不是 `12.3 年`）。**恒定的是槽数，不是小数位数**
 * ——`12 年` 和 `9.5 年` 占一样宽，列不会因此跳；而「前 12.3 年」会比它旁边
 * 那些多出一个字身，把这条对齐线破掉。十年这个量级上的一位小数本来也不参与
 * 任何判断——没人靠 0.3 年选人。
 */
export function years(months: number) {
	const y = months / 12;
	// 9.95 而不是 10：toFixed 会把 9.96 印成「10.0」，那是第四个槽
	return `${y >= 9.95 ? Math.round(y) : y.toFixed(1)} 年`;
}
