/**
 * 并列的几样拼成一行，空的不占位。` · ` 是全站唯一的并列分隔符，不在各处另挑符号。
 */
export function dots(...parts: (string | null | undefined)[]) {
	return parts.filter(Boolean).join(" · ");
}

/** 一个人现在在哪儿：部门 · 职位 · 职级。 */
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

/** 精确到月的时长：11 个月 / 2 年 / 2 年 3 个月。 */
export function duration(months: number) {
	if (months < 12) return `${months} 个月`;
	const y = Math.floor(months / 12);
	const m = months % 12;
	return m ? `${y} 年 ${m} 个月` : `${y} 年`;
}

/**
 * 证据行右端的时长，折成年、恒定占三个数位槽，好让一列上下比长短：
 * 十年以下留一位小数（`9.5 年`），十年以上取整（`12 年`）。
 */
export function years(months: number) {
	const y = months / 12;
	// 9.95 而不是 10：toFixed 会把 9.96 印成「10.0」，那是第四个槽
	return `${y >= 9.95 ? Math.round(y) : y.toFixed(1)} 年`;
}

/** 整数带千分位：`31,279`。 */
export function integer(n: number) {
	return n.toLocaleString("en-US");
}
