/** 已校验闭区间按含首尾日的天数换算月数；倒置区间拒绝写库。 */
export function durationMonths(start: Date, end: Date): number {
	if (end < start)
		throw new Error(
			`无效日期区间：${start.toISOString()} — ${end.toISOString()}`,
		);
	const days = (end.getTime() - start.getTime()) / 86_400_000;
	const months = Math.round((days + 1) / 30.44);
	return months > 0 ? months : 1;
}
