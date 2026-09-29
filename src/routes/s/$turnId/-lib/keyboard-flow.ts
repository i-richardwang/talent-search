import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import type { SearchResult } from "#/search/result";
import type { View } from "./view-params";

/**
 * `/` 改查询，↑↓ / jk 换人，空格选中或取消正在看的这个人，Esc 先关详情、没开详情时
 * 清空已选的人，`?` 打开快捷键列表。批量筛人时手不必离开键盘。
 *
 * 窄屏详情浮层、导出对话框、快捷键列表的 Esc 归它们自己：焦点在 `[role=dialog]` 里时这里不接。
 */
export function useKeyboardFlow({
	onEditQuery,
	onCloseDetail,
	results,
	empId,
	turnId,
	view,
	onPick,
	picked,
	onClearPicks,
	onHelp,
}: {
	/** 把光标放进改查询的地方：对话是右栏线程底下的输入框，关键词是名单上方的「经历或技能」。 */
	onEditQuery: () => void;
	onCloseDetail: () => void;
	results: SearchResult[];
	empId: string | undefined;
	/** 换人只换详情面板，仍然停在这一条查询记录上 */
	turnId: string;
	view: View;
	/** 选中或取消正在看的这个人。 */
	onPick: (empId: string) => void;
	/** 已经选了几个人。 */
	picked: number;
	onClearPicks: () => void;
	/** 打开快捷键列表。 */
	onHelp: () => void;
}) {
	const navigate = useNavigate();

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			// 输入法组合输入期间的按键归输入法。
			if (e.isComposing || e.keyCode === 229) return;
			const el = document.activeElement;
			// 正在输入，或焦点落在下拉／弹层里时，键盘归它们
			const busy =
				el instanceof HTMLElement &&
				(el.tagName === "INPUT" ||
					el.tagName === "TEXTAREA" ||
					el.isContentEditable ||
					el.closest('[role="listbox"],[role="dialog"],[role="menu"]') !==
						null);
			// 焦点在详情面板里时，↑↓ 用来滚动详情，不换人。
			const reading =
				el instanceof HTMLElement && el.closest("[data-pane=detail]") !== null;

			if (e.key === "/" && !busy) {
				e.preventDefault();
				onEditQuery();
				return;
			}
			if (e.key === "?" && !busy) {
				e.preventDefault();
				onHelp();
				return;
			}
			if (e.key === "Escape") {
				// 输入框、下拉、对话框里的 Esc 归它们自己。
				if (busy) return;
				if (empId) {
					e.preventDefault();
					onCloseDetail();
					return;
				}
				if (picked > 0) {
					e.preventDefault();
					onClearPicks();
					return;
				}
			}
			if (busy || reading || results.length === 0) return;

			// 长按不连发：按键重复比导航快，连续几次会读到同一个 empId，按住空格则会
			// 反复选中又取消。
			if (e.repeat) return;

			// 当前这个人：↑↓ 移到的那一个，还没移到任何人时是 -1。
			const at = results.findIndex((r) => r.employee.empId === empId);

			// 空格选中／取消正在看的这个人：↑↓ 移到谁，选的就是谁。没在看任何人时
			// 空格照常翻页。
			if (e.key === " " && at >= 0) {
				e.preventDefault();
				const one = results[at]?.employee.empId;
				if (one) onPick(one);
				return;
			}

			const step =
				e.key === "ArrowDown" || e.key === "j"
					? 1
					: e.key === "ArrowUp" || e.key === "k"
						? -1
						: 0;
			if (step === 0) return;
			e.preventDefault();

			// 还没选人时，↓ 移到第一个、↑ 移到最后一个
			const next =
				at < 0
					? step > 0
						? 0
						: results.length - 1
					: Math.min(Math.max(at + step, 0), results.length - 1);
			const target = results[next]?.employee.empId;
			if (!target || target === empId) return;

			// replace：换人不进历史栈，后退键仍回到上一次查询。
			navigate({
				to: "/s/$turnId/p/$empId",
				params: { turnId, empId: target },
				search: view,
				replace: true,
			});
			// 名单行带 scroll-my，落点离容器边缘留一点余量
			document
				.querySelector(`[data-emp="${CSS.escape(target)}"]`)
				?.scrollIntoView({ block: "nearest" });
		};

		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [
		onEditQuery,
		onCloseDetail,
		onPick,
		picked,
		onClearPicks,
		onHelp,
		results,
		empId,
		turnId,
		view,
		navigate,
	]);
}
