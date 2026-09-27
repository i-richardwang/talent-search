import type { Pick } from "./picks";

/**
 * 把挑出来的人写成一份 CSV，在浏览器里做完：要导出的每一格都在 `picks.ts` 的快照里，
 * 和屏幕上是同一份数据。
 */

/**
 * 每个人固定的那几列，主张那几列跟在后面、一条一列。导出对话框照它列出列名
 * （`-components/pick-dock.tsx`），屏幕和文件同一个出处。
 */
export const FIXED = ["序号", "工号", "姓名", "部门", "岗位", "职级"] as const;

/** 一个格子：含逗号、引号、换行的包起来，引号自身翻倍（RFC 4180）。 */
function cell(value: string | number | null) {
	const text = value === null ? "" : String(value);
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** `names` 是各主张的名字，和 `Pick.evidence` 同序。 */
export function toCsv(picks: Pick[], names: string[], evidence: boolean) {
	const head = evidence ? [...FIXED, ...names] : FIXED;
	const rows = picks.map((p) => [
		p.rank,
		p.empId,
		p.name,
		p.dept,
		p.title,
		p.level,
		...(evidence ? names.map((_, i) => p.evidence[i] ?? "") : []),
	]);
	// CRLF 换行；开头的 BOM 让 Excel 按 UTF-8 打开中文。
	return `﻿${[head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

export function csvName(now = new Date()) {
	const day = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, "0"),
		String(now.getDate()).padStart(2, "0"),
	].join("-");
	return `人才搜索-${day}.csv`;
}

/** 把一份 CSV 文本交给浏览器下载。 */
export function download(name: string, text: string) {
	const url = URL.createObjectURL(
		new Blob([text], { type: "text/csv;charset=utf-8" }),
	);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}
