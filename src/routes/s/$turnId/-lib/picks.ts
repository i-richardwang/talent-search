import { useCallback, useMemo, useReducer, useRef } from "react";
import type { Claim } from "#/search/query";
import type {
	RankedResult,
	ResultEmployee,
	SearchOutcome,
} from "#/search/result";
import { evidenceText } from "../-components/evidence";
import { type ClaimLine, claimLines } from "./claim-lines";

/**
 * 选中待导出的一个人：名单上那一行的快照。改筛选后被筛掉的人仍算选中，导出的就是选中的这些
 * 人，留着他最后一次在名单上的样子；还在名单上的，名单更新时快照跟着换成新的那一行。
 */
export type Pick = {
	empId: string;
	name: string;
	dept: string | null;
	title: string | null;
	level: string | null;
	/** 在这份名单里排第几，导出时写成一列。 */
	rank: number;
	/** 每条主张一格，和 `SearchOutcome.claims` 同序；没命中的是 null。 */
	evidence: (string | null)[];
};

/** 名单上的一项：渲染需要的数据和选中需要的数据出自同一次推导。 */
type Row = {
	employee: ResultEmployee;
	/** 每条主张一格，和 `SearchOutcome.claims` 同序 */
	lines: ClaimLine[];
	pick: Pick;
};

const NONE: ReadonlyMap<string, Pick> = new Map();

/** 选择只看名单上一项的快照。 */
type Listed = { pick: Pick };

/** 选择的状态：选中了谁，说的是哪条记录的哪一份名单。 */
type Selection = {
	turnId: string;
	/** 名单上现在这一份，按屏幕顺序。 */
	rows: readonly Listed[];
	picked: ReadonlyMap<string, Pick>;
	/** 「选择全部」还在等下一份名单：到了就把那一份上的人也选中。 */
	sweeping: boolean;
};

type Action =
	/** 这一次渲染的记录和名单。 */
	| { type: "show"; turnId: string; rows: readonly Listed[] }
	/** 名单上这些复选框的新状态：勾着的是这几个工号。 */
	| { type: "check"; ids: readonly string[] }
	| { type: "toggle"; empId: string }
	| { type: "remove"; empId: string }
	/** 选中名单上全部的人；`more` 为真时下一份名单上的人也选中。 */
	| { type: "pickAll"; more: boolean }
	/** 选中名单上第 `from` 到第 `to` 个人（含两端）。 */
	| { type: "pickRange"; from: number; to: number }
	| { type: "clear" };

/** 把名单上这几项选中；名单外已经选中的原样留着（快照的道理见 `Pick`）。 */
function withAll(
	old: ReadonlyMap<string, Pick>,
	rows: readonly Listed[],
): ReadonlyMap<string, Pick> {
	const next = new Map(old);
	for (const { pick } of rows) next.set(pick.empId, pick);
	return next;
}

/** 一条记录刚打开时的选择：谁都没选。 */
export function opened(turnId: string, rows: readonly Listed[]): Selection {
	return { picked: NONE, rows, sweeping: false, turnId };
}

/** 选择的全部变化。纯函数：同一份状态和同一个动作总是得到同一份新状态。 */
export function select(state: Selection, action: Action): Selection {
	switch (action.type) {
		case "show": {
			// 换了一条记录：选中的人不带到按别的条件搜出的名单上
			if (action.turnId !== state.turnId)
				return opened(action.turnId, action.rows);
			// 名单换了一份（加载更多、改筛选、补上了新的人）：已选的人换成新的那一行，
			// 「选择全部」等着的那一批也补上；这笔补选只等这一份。
			const { rows } = action;
			if (!state.sweeping && state.picked.size === 0) return { ...state, rows };
			const picked = new Map(state.picked);
			for (const { pick } of rows)
				if (state.sweeping || picked.has(pick.empId))
					picked.set(pick.empId, pick);
			return { ...state, picked, rows, sweeping: false };
		}
		case "check": {
			// 不在名单上的已选人原样保留
			const on = new Set(action.ids);
			const listed = new Map(state.rows.map((r) => [r.pick.empId, r.pick]));
			const picked = new Map(
				[...state.picked].filter(([id]) => !listed.has(id) || on.has(id)),
			);
			for (const id of on) {
				const pick = listed.get(id);
				if (pick) picked.set(id, pick);
			}
			return { ...state, picked };
		}
		case "toggle": {
			const picked = new Map(state.picked);
			if (picked.delete(action.empId)) return { ...state, picked };
			const pick = state.rows.find((r) => r.pick.empId === action.empId)?.pick;
			if (!pick) return state;
			picked.set(action.empId, pick);
			return { ...state, picked };
		}
		case "remove": {
			if (!state.picked.has(action.empId)) return state;
			const picked = new Map(state.picked);
			picked.delete(action.empId);
			return { ...state, picked };
		}
		case "pickAll":
			return {
				...state,
				picked: withAll(state.picked, state.rows),
				sweeping: action.more,
			};
		case "pickRange":
			return {
				...state,
				picked: withAll(
					state.picked,
					state.rows.slice(action.from, action.to + 1),
				),
			};
		case "clear":
			return { ...state, picked: NONE, sweeping: false };
	}
}

/**
 * 把一条结果推导成名单上的一项。有没有证据由调用方按 `SearchOutcome.order` 决定，
 * 按人排时传 `null`。
 */
function rowOf(
	e: ResultEmployee,
	ranked: RankedResult | null,
	rank: number,
	claims: Claim[],
): Row {
	const lines = claimLines(ranked, claims);
	return {
		employee: e,
		lines,
		pick: {
			dept: e.curDept,
			empId: e.empId,
			evidence: lines.map(({ found }) =>
				found ? evidenceText(found.evidence, found.basis) : null,
			),
			level: e.curLevel,
			name: e.name,
			rank,
			title: e.curTitle,
		},
	};
}

/**
 * 选择的全部状态：选中了谁。
 *
 * 只在内存里，不进地址：每勾一次都压一条历史记录会让后退键失效。换一条查询记录
 * 就清空，选中的人不带到按别的条件搜出的名单上。
 */
export function usePicks(turnId: string, outcome: SearchOutcome) {
	const rows = useMemo(
		() =>
			outcome.order === "employee"
				? outcome.results.map((r, i) =>
						rowOf(r.employee, null, i + 1, outcome.claims),
					)
				: outcome.results.map((r, i) =>
						rowOf(r.employee, r, i + 1, outcome.claims),
					),
		[outcome.order, outcome.results, outcome.claims],
	);

	// 记录或名单换了，在这一次渲染里就对齐：新名单的第一帧不带旧的已选人数。
	const [state, dispatch] = useReducer(select, opened(turnId, rows));
	if (state.turnId !== turnId || state.rows !== rows)
		dispatch({ rows, turnId, type: "show" });
	const { picked } = state;

	/** 当前名单上这批人的工号，按屏幕顺序。表头的全选读它。 */
	const shownIds = useMemo(() => rows.map((r) => r.pick.empId), [rows]);

	/**
	 * 当前名单上勾选了哪几个，即交给 `CheckboxGroup` 的值。被筛掉的已选人不在其中，
	 * 否则全选框会一直是半选。
	 */
	const shownPicked = useMemo(
		() => shownIds.filter((id) => picked.has(id)),
		[picked, shownIds],
	);

	/** 写入名单上这些复选框的新状态，单个复选框和表头全选都走这里。 */
	const setShown = useCallback(
		(ids: string[]) => dispatch({ ids, type: "check" }),
		[],
	);

	// 连选的起点：上一次点选或空格选过的那个人，只在选他的那条记录里算数。
	const anchor = useRef<{ turnId: string; empId: string } | null>(null);

	const toggle = useCallback(
		(empId: string) => {
			anchor.current = { empId, turnId };
			dispatch({ empId, type: "toggle" });
		},
		[turnId],
	);

	/**
	 * 移除一个已选的人，不要求他在当前名单上：被筛掉的已选人只能从这里移除。
	 * 工具栏上的清单用它（`-components/pick-dock.tsx`）。
	 */
	const remove = useCallback(
		(empId: string) => dispatch({ empId, type: "remove" }),
		[],
	);

	/**
	 * 把显示上限内的人全部选中：先选名单上已有的；`more` 为真时，下一份名单到达后补上
	 * 其余的。这笔补选只等下一份名单，换记录、清空都取消它。
	 */
	const pickAll = useCallback(
		(more: boolean) => dispatch({ more, type: "pickAll" }),
		[],
	);

	/**
	 * 点了名单上一个人的选择框。按着 Shift、且上一次选过的人还在名单上时，把两人之间
	 * （含两端）全部选中，已选的不取消，返回 true，调用处拦下这个框自己的切换；
	 * 否则只把这个人记作下一次连选的起点，返回 false，框按它自己的切换来。
	 */
	const pointAt = useCallback(
		(empId: string, shift: boolean) => {
			const last = anchor.current?.turnId === turnId ? anchor.current : null;
			anchor.current = { empId, turnId };
			const from = rows.findIndex((r) => r.pick.empId === last?.empId);
			const to = rows.findIndex((r) => r.pick.empId === empId);
			if (!shift || from < 0 || to < 0) return false;
			dispatch({
				from: Math.min(from, to),
				to: Math.max(from, to),
				type: "pickRange",
			});
			return true;
		},
		[rows, turnId],
	);

	const clear = useCallback(() => {
		anchor.current = null;
		dispatch({ type: "clear" });
	}, []);

	return {
		clear,
		picked,
		pickAll,
		pointAt,
		remove,
		rows,
		setShown,
		shownIds,
		shownPicked,
		toggle,
	};
}

export type Picks = ReturnType<typeof usePicks>;
