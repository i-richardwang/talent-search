/**
 * 序列三级拼成一行：空的那一级不占位。
 *
 * 序列常常只有一级或两级（外部经历三级全空），所以过滤是规则的一部分，
 * 不是防御。分隔符和全站其余的并列信息一致，都是 ` · `。
 */
export function seqLabel(...levels: (string | null)[]) {
	return levels.filter(Boolean).join(" · ");
}

/** 起止：2021-03 – 2024-10 / 2021-03 – 至今 */
export function period(start: string, end: string | null) {
	return `${start.slice(0, 7)} – ${end ? end.slice(0, 7) : "至今"}`;
}

/** 时长：11 个月 / 2 年 / 2 年 3 个月。详情栏和时间轴用它，那里要的是准确。 */
export function duration(months: number) {
	if (months < 12) return `${months} 个月`;
	const y = Math.floor(months / 12);
	const m = months % 12;
	return m ? `${y} 年 ${m} 个月` : `${y} 年`;
}

/**
 * 表格里的时长：折成年，**恒定占三个数位槽**。
 *
 * 「2 年 3 个月」在 6rem 的列里量出来只剩不到一个字的余量，加上「前 」就得靠
 * 省略号收场——而省略号是把放不下这件事推给读者。折成年之后配 tabular-nums
 * 就是一列能上下比大小的数，而扫五十行时要的正是这个：粗略比长短。
 * 精确到月的那一份在 tooltip 和详情栏里，一个都没丢。
 *
 * 十年以上丢掉小数位（`12 年` 而不是 `12.3 年`）。**恒定的是槽数，不是小数位数**
 * ——那一列右对齐加 tabular-nums，`12 年` 和 `9.5 年` 占一样宽，列不会因此跳。
 * 而「前 12.3 年」比 6rem 减去点和间距之后剩下的宽度还长，会溢出到隔壁格；
 * 十年这个量级上的一位小数本来也不参与任何判断——没人靠 0.3 年挑人。
 */
export function years(months: number) {
	const y = months / 12;
	// 9.95 而不是 10：toFixed 会把 9.96 印成「10.0」，那是第四个槽
	return `${y >= 9.95 ? Math.round(y) : y.toFixed(1)} 年`;
}

/**
 * 千分位：1234 → 1,234。
 *
 * 自己写而不用 `toLocaleString()`：不带 locale 的那个调用在服务端和浏览器里
 * 可能给出不同的分组和分隔符（Node 的 ICU 与浏览器的默认 locale 未必一致），
 * 而 SSR 直出的字符串和水合时算出来的字符串一旦不同，React 会整棵子树重画，
 * 页面上什么都看不出来。这里只处理非负整数，也就是全站数「人」和「段」的那些数。
 */
export function grouped(n: number) {
	return String(n).replace(/\B(?=(\d{3})+$)/g, ",");
}

/**
 * 多久以前：刚刚 / 12 分钟前 / 3 小时前 / 昨天 / 03-14。
 *
 * 「最近搜索」要回答的是「哪一条是我刚才那次」，而不是「它精确发生在几点」。
 * 一天以内用相对时间，跨天之后相对时间反而难读（「37 小时前」要在脑子里换算），
 * 所以昨天单独说，再往前就直接给日期。
 *
 * 传入 `now` 而不是在里面读时钟：这个函数会在 SSR 和水合两侧各跑一次，
 * 两次读到的时钟差几百毫秒就足以让「刚刚」变成「1 分钟前」，
 * 于是整棵子树被 React 判为不一致而重画。时钟归调用方，这里保持是个纯函数。
 */
export function since(iso: string, now: number) {
	const then = new Date(iso);
	const min = Math.floor((now - then.getTime()) / 60000);
	if (min < 1) return "刚刚";
	if (min < 60) return `${min} 分钟前`;
	if (min < 24 * 60) return `${Math.floor(min / 60)} 小时前`;
	if (min < 48 * 60) return "昨天";
	return `${String(then.getMonth() + 1).padStart(2, "0")}-${String(then.getDate()).padStart(2, "0")}`;
}
