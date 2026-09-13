import { useCallback, useMemo, useRef, useState } from "react";
import { evidenceText } from "#/components/evidence";
import { claimName } from "#/search/condition-label";
import { bestHitPerClaim } from "#/search/evidence";
import type {
	Claim,
	ClaimBasis,
	Hit,
	RankedResult,
	SearchOutcome,
	SearchResult,
} from "#/search/result";

/**
 * 挑出来准备导出的一个人。
 *
 * 它是**挑上那一刻的一份快照**，不是一个指向名单的下标：挑完再去改左边的筛选，
 * 被筛掉的那几个人不会从名单里悄悄消失——「已选 12 人」说的是 12 个人，导出的
 * 也是这 12 个。凭据不会因为筛选而变（证据只由条件决定），所以这份快照和屏幕上
 * 那一块永远是同一份，不存在两个口径。
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

/** 名单上的一块：画出来要的东西和挑上要的东西，出自同一次推导。 */
type Row = {
	result: SearchResult;
	/** 命中的主张，逐条画一行 */
	hits: { claim: Claim; name: string; hit: Hit; basis: ClaimBasis }[];
	/** 没命中的主张的名字，收成一行 */
	missed: string[];
	pick: Pick;
};

const NONE: ReadonlyMap<string, Pick> = new Map();

function isRanked(result: SearchResult): result is RankedResult {
	return "score" in result;
}

/**
 * 一个结果推成一块。
 *
 * 样例段和聚合依据出自同一次筛选，所以这两样要么都在、要么都不在
 * （`EvidenceLine` 的 `basis` 不可空，理由在那里）。
 */
function rowOf(result: SearchResult, rank: number, claims: Claim[]): Row {
	const ranked = isRanked(result) ? result : null;
	const best = bestHitPerClaim(ranked?.hits ?? [], claims);
	const lines = claims.map((claim, i) => {
		const hit = best[i];
		const basis = ranked?.basis[i];
		return hit && basis ? { basis, hit, claim, name: claimName(claim) } : null;
	});
	const e = result.employee;
	return {
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
		result,
	};
}

/**
 * 挑人这件事的全部状态：在不在挑、挑了谁。
 *
 * **不进 URL。** 地址栏上那份是「我怎么看这批人」（`view-params.ts` 开头那段
 * 分界），随手改、粘给同事都成立；而挑出来的这一小撮是手上正在做的一份活，
 * 三十个工号写进 query string 只会让每勾一下就往历史栈里压一条，后退键当场作废。
 *
 * 换一条查询记录就从头来过：换了问题，上一批人是按另一套条件挑的，把它们带过来
 * 会导出一份没有统一口径的名单。退出挑人也一样清空——这件事有开始有结束，
 * 收工就是收工，留一份看不见的选中在后台是更坏的那种「省事」。
 */
export function usePicks(turnId: string, outcome: SearchOutcome) {
	const rows = useMemo(
		() => outcome.results.map((r, i) => rowOf(r, i + 1, outcome.claims)),
		[outcome.results, outcome.claims],
	);
	const [picking, setPicking] = useState(false);
	const [picked, setPicked] = useState(NONE);

	// 换记录时就地归零。写在渲染里而不是 effect 里：effect 要等这一帧画完才跑，
	// 那一帧屏幕上会是新名单配着旧的「已选 12 人」。
	const seen = useRef(turnId);
	if (seen.current !== turnId) {
		seen.current = turnId;
		setPicking(false);
		setPicked(NONE);
	}

	/** 名单上这一批人的工号，按屏幕上的顺序。表头那个全选读它。 */
	const shownIds = useMemo(() => rows.map((r) => r.pick.empId), [rows]);

	/**
	 * 名单上勾着的是哪几个——交给 `CheckboxGroup` 的那份值。
	 *
	 * 它只报**名单上**的：筛选改过之后被筛掉的那几个人仍然算挑上（见 `Pick` 的
	 * 快照那段），但屏幕上没有对应的框可勾，报出去只会让全选那个框永远处在
	 * 「勾不满」的状态。
	 */
	const shownPicked = useMemo(
		() => shownIds.filter((id) => picked.has(id)),
		[picked, shownIds],
	);

	/**
	 * 名单上这几个框的新状态。个别一个框和表头那个全选走的是同一条路——
	 * `CheckboxGroup` 两样都记在同一份值里，这里就不必分两个函数。
	 *
	 * 不在名单上的那几份快照原样留着：它们不是被人取消的，只是这一刻没画出来。
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

	// 键盘那条路（空格挑上／取消当前这个人）只认得一个人，走不了上面那份整表的值。
	const toggle = useCallback(
		(empId: string) => {
			const pick = rows.find((r) => r.pick.empId === empId)?.pick;
			if (!pick) return;
			setPicked((old) => {
				const next = new Map(old);
				if (!next.delete(empId)) next.set(empId, pick);
				return next;
			});
		},
		[rows],
	);

	const start = useCallback((on: boolean) => {
		setPicking(on);
		if (!on) setPicked(NONE);
	}, []);

	const clear = useCallback(() => setPicked(NONE), []);

	return {
		clear,
		picked,
		picking,
		rows,
		setShown,
		shownIds,
		shownPicked,
		start,
		toggle,
	};
}

export type Picks = ReturnType<typeof usePicks>;
