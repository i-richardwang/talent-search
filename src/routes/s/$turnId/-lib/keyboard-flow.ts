import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import type { SearchResult } from "#/search/result";
import type { View } from "./view-params";

/**
 * `/` 改问题，↑↓ / jk 换人，Esc 关闭详情，挑人时空格挑上或取消。
 * 批量筛人时手不用离开键盘。
 *
 * 窄屏那个详情浮层的 Esc 不归这里：它是 coss 的 `Dialog`，自带 Esc 关闭、焦点
 * 陷阱与还焦。下面的 `busy` 判定已经把焦点落在 `[role=dialog]` 里的按键让了出去，
 * 所以这里再写一遍只会和它抢。
 */
export function useKeyboardFlow({
	onEditQuery,
	results,
	empId,
	turnId,
	view,
	onPick,
}: {
	/** 展开查询台上那句话的改写框（见 `-components/query-deck.tsx`）。 */
	onEditQuery: () => void;
	results: SearchResult[];
	empId: string | undefined;
	/** 换人只换详情面板，仍然停在这一条查询记录上 */
	turnId: string;
	view: View;
	/**
	 * 挑上或取消当前这个人。不在挑人时是 undefined——那时空格归页面滚动，
	 * 抢过来会让一个什么都没开的名单按空格不动，而人只会以为页面卡了。
	 */
	onPick?: (empId: string) => void;
}) {
	const navigate = useNavigate();

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			// 输入法组合输入期间的按键归输入法。今天中文只会打在改写框那个
			// <textarea> 里，busy 已经兜住，但这道保险不依赖「输入一定发生在
			// 表单元素里」。
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
			// 焦点走进详情面板之后，↑↓ 归它：简历原文动辄十几段，
			// 读到一半按方向键却换了个人，是这套快捷键最容易伤人的地方。
			const reading =
				el instanceof HTMLElement && el.closest("[data-pane=detail]") !== null;

			if (e.key === "/" && !busy) {
				e.preventDefault();
				onEditQuery();
				return;
			}
			if (e.key === "Escape") {
				// 输入框、下拉、对话框里的 Esc 归它们自己：改写框用它收起来，
				// 弹层用它关掉。抢过来只会让 Esc 在同一次按键里做两件事。
				if (busy) return;
				if (empId) {
					e.preventDefault();
					navigate({
						to: "/s/$turnId",
						params: { turnId },
						search: view,
						replace: true,
					});
					return;
				}
			}
			if (busy || reading || results.length === 0) return;
			// 空格挑上／取消当前这个人：↑↓ 走到谁，挑的就是谁，两个键说的是同一个
			// 「当前」。没开着人的时候不接管——那时它没有对象可挑。
			if (e.key === " " && onPick && empId) {
				e.preventDefault();
				onPick(empId);
				return;
			}
			// 长按不连发：navigate 是异步的，系统按键重复（~30/s）远快于重渲染，
			// 连续几次读到的都是同一个 empId，算出同一个落点然后被自己挡掉，
			// 表现就是按住 ↓ 时光标一顿一顿地走。连按交给用户自己按。
			if (e.repeat) return;

			const step =
				e.key === "ArrowDown" || e.key === "j"
					? 1
					: e.key === "ArrowUp" || e.key === "k"
						? -1
						: 0;
			if (step === 0) return;
			e.preventDefault();

			const at = results.findIndex((r) => r.employee.empId === empId);
			// 还没选人时，↓ 落到第一个、↑ 落到最后一个
			const next =
				at < 0
					? step > 0
						? 0
						: results.length - 1
					: Math.min(Math.max(at + step, 0), results.length - 1);
			const target = results[next]?.employee.empId;
			if (!target || target === empId) return;

			// replace：换人是"在看哪一个"，不是一次导航。不 replace 的话扫过
			// 三十个人就往历史栈里压三十条，浏览器的后退键（和手机侧滑）失效。
			navigate({
				to: "/s/$turnId/p/$empId",
				params: { turnId, empId: target },
				search: view,
				replace: true,
			});
			// 块上有 scroll-my，落点会离容器边缘留一点余量；CSS.escape 与列表那边同源
			document
				.querySelector(`[data-emp="${CSS.escape(target)}"]`)
				?.scrollIntoView({ block: "nearest" });
		};

		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onEditQuery, onPick, results, empId, turnId, view, navigate]);
}
