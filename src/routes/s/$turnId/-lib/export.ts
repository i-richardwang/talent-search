import type { Pick } from "./picks";

/** 名单与匹配证据的唯一导出列定义，导出对话框共用这些名字。 */
export const FIXED = ["序号", "工号", "姓名", "部门", "岗位", "职级"] as const;

/** XLSX 显式保留文本类型；工号、原文和条件都不参与公式或数字推断。 */
export async function exportWorkbook(
	picks: Pick[],
	names: string[],
	evidence: boolean,
): Promise<Blob> {
	const { default: writeExcelFile } = await import(
		"write-excel-file/universal"
	);
	const head = evidence ? [...FIXED, ...names] : [...FIXED];
	const rows = picks.map((p) => [
		p.rank,
		p.empId,
		p.name,
		p.dept,
		p.title,
		p.level,
		...(evidence ? names.map((_, i) => p.evidence[i] ?? null) : []),
	]);
	return writeExcelFile([head, ...rows], { sheet: "人才名单" }).toBlob();
}

export function exportName(now = new Date()) {
	const day = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, "0"),
		String(now.getDate()).padStart(2, "0"),
	].join("-");
	return `人才搜索-${day}.xlsx`;
}

export function download(name: string, file: Blob) {
	const url = URL.createObjectURL(file);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	URL.revokeObjectURL(url);
}
