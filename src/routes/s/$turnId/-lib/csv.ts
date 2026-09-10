import type { Pick } from "./picks";

/**
 * 把挑出来的人写成一份 CSV。
 *
 * **CSV 而不是 xlsx**：这份名单的去处是贴进邮件、发给用人部门、或者在 Excel 里
 * 再排一次序——这些 CSV 全都做得到，而 xlsx 要多背一个写文件的库，换来的只是
 * 单元格能上色。
 *
 * 整件事在浏览器里做完，不回服务端：要导出的每一格屏幕上都已经有了
 * （`picks.ts` 的快照），再发一次请求就是让同一份数据有两条路径，
 * 而那两条早晚会给出不一样的东西。
 */

/**
 * 每个人固定的那几列。条件那几列跟在后面，一条条件一列。
 *
 * 导出那一层把它逐列画出来给人看（`-components/pick-dock.tsx`），所以它得出去：
 * 屏幕上说有哪几列、文件里就有哪几列，两处只能有一个出处。
 */
export const FIXED = ["序号", "工号", "姓名", "部门", "岗位", "职级"] as const;

/**
 * 一个格子。含逗号、引号、换行的要包起来，引号自身翻倍——这是 RFC 4180 的
 * 全部内容，不值得为它装一个库。
 */
function cell(value: string | number | null) {
	const text = value === null ? "" : String(value);
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(picks: Pick[], terms: string[], evidence: boolean) {
	const head = evidence ? [...FIXED, ...terms] : FIXED;
	const rows = picks.map((p) => [
		p.rank,
		p.empId,
		p.name,
		p.dept,
		p.title,
		p.level,
		...(evidence ? terms.map((t) => p.evidence[t] ?? "") : []),
	]);
	// CRLF：Excel 之外的东西也认，反过来不成立。
	// 开头那个 BOM 是给 Excel 的：没有它，中文在简体中文版 Windows 上打开是乱码。
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

/** 把一份文本交给浏览器下载。这是它唯一的用途，所以不做成通用的。 */
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
