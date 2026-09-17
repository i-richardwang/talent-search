import { useCallback, useMemo, useRef, useState } from "react";
import { evidenceText } from "#/components/evidence";
import { claimName } from "#/search/condition-label";
import { bestHitPerClaim } from "#/search/evidence";
import type {
	Claim,
	ClaimBasis,
	Hit,
	RankedResult,
	ResultEmployee,
	SearchOutcome,
} from "#/search/result";

/**
 * 选中待导出的一个人。
 *
 * 它是选中那一刻的快照，不是指向名单的下标：选完再改筛选时，被筛掉的人不会从
 * 选中集合里消失——「已选 12 人」就是 12 个人，导出的也是这 12 个。凭据不随筛选
 * 变化（证据只由条件决定），所以这份快照和屏幕上那张卡片始终一致。
 */
export type Pick = {
	empId: string;
	name: string;
	dept: string | null;
	title: string | null;
	level: string | null;
	/** 在这份名单里排第几。CSV 一排序就把顺序丢了，所以名次得写成一列。 */
	rank: number;
	/** 每条主张一格，和 `SearchOutcome.claims` 同序；没命中的是 null。 */
	evidence: (string | null)[];
};

/** 名单上的一项：渲染需要的数据和选中需要的数据出自同一次推导。 */
type Row = {
	employee: ResultEmployee;
	/** 命中的主张，逐条渲染一行 */
	hits: { claim: Claim; name: string; hit: Hit; basis: ClaimBasis }[];
	/** 没命中的主张的名字，合成一行 */
	missed: string[];
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
 * 把一条结果推导成名单上的一项。
 *
 * 有没有证据可渲染由调用方按 `SearchOutcome.order` 决定（只有人的条件时是
 * `"employee"`，没有主张也就没有证据），不靠在结果对象上探测字段：探测的字段一旦
 * 改名，每个人都会静默渲染成「未命中」，而不会有任何断言失败。
 *
 * 样例段和聚合依据出自同一次筛选，所以两者要么都有、要么都没有
 * （`EvidenceLine` 的 `basis` 不可空，原因写在那里）。
 */
function rowOf(
	e: ResultEmployee,
	ranked: RankedResult | null,
	rank: number,
	claims: Claim[],
): Row {
	const best = bestHitPerClaim(ranked?.hits ?? [], claims);
	const lines = claims.map((claim, i) => {
		const hit = best[i];
		const basis = ranked?.basis[i];
		return hit && basis ? { basis, hit, claim, name: claimName(claim) } : null;
	});
	return {
		employee: e,
		hits: lines.filter((line) => line !== null),
		missed: claims.filter((_, i) => !lines[i]).map(claimName),
		pick: {
			dept: e.curDept,
			empId: e.empId,
			evidence: lines.map((line) =>
				line ? evidenceText(line.name, line.hit, line.basis) : null,
			),
			level: e.curLevel,
			name: e.name,
			rank,
			title: e.curTitle,
		},
	};
}

/**
 * 挑人的全部状态：是否处于挑人模式、选中了谁。
 *
 * 不进 URL。地址栏保存的是「怎么看这批人」（分界见 `view-params.ts` 开头），可以
 * 随意修改、分享给同事；而选中集合是当前正在进行的一次操作，把三十个工号写进
 * query string 会让每勾一次就往历史栈压一条记录，后退键随之失效。
 *
 * 换一条查询记录就重置：换了问题之后，上一批人是按另一套条件选的，带过来会导出
 * 一份口径不一致的名单。退出挑人模式同样清空——保留一份不可见的选中状态，之后
 * 会以用户意料之外的方式出现在导出里。
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
	const [picking, setPicking] = useState(false);
	const [picked, setPicked] = useState(NONE);

	// 「选上全部」还欠着的那一批：名单长出来的这一帧就补上，同样不放进 effect。
	const sweeping = useRef(false);
	const swept = useRef(rows);
	if (sweeping.current && swept.current !== rows) {
		sweeping.current = false;
		swept.current = rows;
		setPicked(withAll(rows));
	}

	// 换记录时就地归零。写在渲染里而不是 effect 里：effect 要等这一帧画完才跑，
	// 那一帧屏幕上会是新名单配着旧的「已选 12 人」。
	const seen = useRef(turnId);
	if (seen.current !== turnId) {
		seen.current = turnId;
		sweeping.current = false;
		setPicking(false);
		setPicked(NONE);
	}

	/** 当前名单上这批人的工号，按屏幕顺序。表头的全选读它。 */
	const shownIds = useMemo(() => rows.map((r) => r.pick.empId), [rows]);

	/**
	 * 当前名单上勾选了哪几个，即交给 `CheckboxGroup` 的值。
	 *
	 * 只包含名单上的人：改过筛选后被筛掉的那几个仍然算选中（见 `Pick` 的快照说明），
	 * 但屏幕上没有对应的复选框，一并报上去会让全选框永远处于半选状态。
	 */
	const shownPicked = useMemo(
		() => shownIds.filter((id) => picked.has(id)),
		[picked, shownIds],
	);

	/**
	 * 写入名单上这些复选框的新状态。单个复选框和表头全选走同一条路径——
	 * `CheckboxGroup` 把两者记在同一份值里，所以这里不必拆成两个函数。
	 *
	 * 不在名单上的快照原样保留：它们不是被用户取消的，只是此刻没有渲染出来。
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

	// 键盘路径（空格选中／取消当前这个人）只涉及一个人，用不了上面那份整表的值。
	// 选中需要名单上对应的那一行（快照来自那里），取消不需要，所以先尝试删除，
	// 删不掉再去查找。
	const toggle = useCallback(
		(empId: string) => {
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
	 * 移除一个已经选中的人。
	 *
	 * 不检查他在不在当前名单上——被筛掉的那几个人只能通过这条路径移除。快照这个
	 * 设计的前提就是选中的人可以不在名单上（见 `Pick` 开头），取消也就不能要求他
	 * 在名单上，否则「已选 12 人」里的部分人只能靠清空整批来丢弃。工具栏上的清单
	 * 用它（`-components/pick-dock.tsx`）。
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
	 * 把够得着的人全都选上。
	 *
	 * 名单是一页页长出来的，所以这件事分两步：这一刻先把名单上的选中，`more` 说
	 * 后面还有没有——有的话，等它们到达（`rows` 换了一份）再补上剩下的。
	 *
	 * 这一笔「还欠着」只活到下一份 `rows` 为止，换记录、清空、退出挑人都取消它：
	 * 一个没人记得的「全都要」在几分钟后把新到的人塞进导出里，比不做更坏。
	 */
	const pickAll = useCallback(
		(more: boolean) => {
			sweeping.current = more;
			swept.current = rows;
			setPicked(withAll(rows));
		},
		[rows],
	);

	const start = useCallback((on: boolean) => {
		setPicking(on);
		if (!on) {
			sweeping.current = false;
			setPicked(NONE);
		}
	}, []);

	const clear = useCallback(() => {
		sweeping.current = false;
		setPicked(NONE);
	}, []);

	return {
		clear,
		picked,
		picking,
		pickAll,
		remove,
		rows,
		setShown,
		shownIds,
		shownPicked,
		start,
		toggle,
	};
}

export type Picks = ReturnType<typeof usePicks>;
