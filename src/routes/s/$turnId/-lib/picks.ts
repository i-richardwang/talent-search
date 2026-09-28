import { useCallback, useMemo, useRef, useState } from "react";
import { evidenceText } from "#/components/evidence";
import type {
	Claim,
	RankedResult,
	ResultEmployee,
	SearchOutcome,
} from "#/search/result";
import { type ClaimLine, claimLines } from "./claim-lines";

/**
 * 选中待导出的一个人：选中那一刻的快照。改筛选后被筛掉的人仍算选中，导出的就是
 * 选中的这些人；证据只由条件决定，快照和名单上那一行一致。
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

/** 名单上这批人全部选中，名单外已经选中的原样留着（快照的道理见 `Pick`）。 */
function withAll(rows: Row[]) {
	return (old: ReadonlyMap<string, Pick>) => {
		const next = new Map(old);
		for (const row of rows) next.set(row.pick.empId, row.pick);
		return next;
	};
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
			evidence: lines.map(({ name, found }) =>
				found ? evidenceText(name, found.hit, found.basis) : null,
			),
			level: e.curLevel,
			name: e.name,
			rank,
			title: e.curTitle,
		},
	};
}

/**
 * 选择的全部状态：选中了谁。名单每一行前面都有复选框，勾上第一个就开始选，
 * 清空就结束。
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
	const [picked, setPicked] = useState(NONE);

	// 「选择全部」还没到的那一批：名单长出来的这一帧补上。
	const sweeping = useRef(false);
	const swept = useRef(rows);
	if (sweeping.current && swept.current !== rows) {
		sweeping.current = false;
		swept.current = rows;
		setPicked(withAll(rows));
	}

	// 连选的起点：上一次点选或空格选过的那个人。
	const anchor = useRef<string | null>(null);

	// 换记录时在渲染里清空，新名单的第一帧就不带旧的已选人数。
	const seen = useRef(turnId);
	if (seen.current !== turnId) {
		seen.current = turnId;
		sweeping.current = false;
		anchor.current = null;
		setPicked(NONE);
	}

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

	/**
	 * 写入名单上这些复选框的新状态，单个复选框和表头全选都走这里。不在名单上的
	 * 已选人原样保留。
	 */
	const setShown = useCallback(
		(next: string[]) => {
			const on = new Set(next);
			const byId = new Map(rows.map((r) => [r.pick.empId, r.pick]));
			setPicked((old) => {
				const keep = new Map(
					[...old].filter(([id]) => !byId.has(id) || on.has(id)),
				);
				for (const id of on) {
					const pick = byId.get(id) ?? old.get(id);
					if (pick) keep.set(id, pick);
				}
				return keep;
			});
		},
		[rows],
	);

	// 空格选中／取消一个人：先试着删，删不掉再从名单上取这一行的快照。
	const toggle = useCallback(
		(empId: string) => {
			anchor.current = empId;
			setPicked((old) => {
				const next = new Map(old);
				if (next.delete(empId)) return next;
				const pick = rows.find((r) => r.pick.empId === empId)?.pick;
				if (!pick) return old;
				return next.set(empId, pick);
			});
		},
		[rows],
	);

	/**
	 * 移除一个已选的人，不要求他在当前名单上：被筛掉的已选人只能从这里移除。
	 * 工具栏上的清单用它（`-components/pick-dock.tsx`）。
	 */
	const remove = useCallback((empId: string) => {
		setPicked((old) => {
			if (!old.has(empId)) return old;
			const next = new Map(old);
			next.delete(empId);
			return next;
		});
	}, []);

	/**
	 * 把显示上限内的人全部选中：先选名单上已有的；`more` 为真时，下一份 `rows`
	 * 到达后补上其余的。这笔补选只等下一份 `rows`，换记录、清空都取消它。
	 */
	const pickAll = useCallback(
		(more: boolean) => {
			sweeping.current = more;
			swept.current = rows;
			setPicked(withAll(rows));
		},
		[rows],
	);

	/**
	 * 点了名单上一个人的选择框。按着 Shift、且上一次选过的人还在名单上时，把两人之间
	 * （含两端）全部选中，已选的不取消，返回 true，调用处拦下这个框自己的切换；
	 * 否则只把这个人记作下一次连选的起点，返回 false，框照常切换。
	 */
	const pointAt = useCallback(
		(empId: string, shift: boolean) => {
			const from = rows.findIndex((r) => r.pick.empId === anchor.current);
			const to = rows.findIndex((r) => r.pick.empId === empId);
			anchor.current = empId;
			if (!shift || from < 0 || to < 0) return false;
			setPicked(
				withAll(rows.slice(Math.min(from, to), Math.max(from, to) + 1)),
			);
			return true;
		},
		[rows],
	);

	const clear = useCallback(() => {
		sweeping.current = false;
		anchor.current = null;
		setPicked(NONE);
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
