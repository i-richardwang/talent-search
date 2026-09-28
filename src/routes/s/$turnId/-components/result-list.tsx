import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { Checkbox, CheckboxGroup } from "#/components/ui/checkbox";
import {
	ListView,
	ListViewHeader,
	ListViewLink,
	ListViewRow,
} from "#/components/ui/list";
import { Skeleton } from "#/components/ui/skeleton";
import { Text } from "#/components/ui/text";
import { Tooltip } from "#/components/ui/tooltip";
import { positionLabel } from "#/lib/format";
import { cn } from "#/lib/utils";
import type { Condition } from "#/search/condition";
import { claimName } from "#/search/condition-label";
import { claimsOf, type SearchOutcome } from "#/search/result";
import type { SearchSpec } from "#/search/spec";
import { RESULT_PAGE } from "#/search/weights";
import type { InterpretFault, SearchMode } from "#/server/turn";
import type { ListWait } from "../-lib/nav-phase";
import type { Picks } from "../-lib/picks";
import { reachOf, type View } from "../-lib/view-params";
import { ClaimProgress, ClaimRow } from "./claim-evidence";
import { PickDock } from "./pick-dock";
import { NoResults, NotUnderstood, ResultHeader } from "./result-state";

/** 占位等过这么久才出现：更快回来的等待里旧画面原样留着，不闪一下占位。 */
export const SKELETON_DELAY = 200;

/** 占位几行：一屏名单的高度，回来的名单从同一处接着排。 */
const SKELETON_ROWS = 6;

/** `on` 连续为真满 `SKELETON_DELAY` 毫秒之后才为真，一变假就回到假。 */
function useDelayed(on: boolean) {
	const [elapsed, setElapsed] = useState(false);
	useEffect(() => {
		setElapsed(false);
		if (!on) return;
		const timer = setTimeout(() => setElapsed(true), SKELETON_DELAY);
		return () => clearTimeout(timer);
	}, [on]);
	return on && elapsed;
}

/** 名单一行的占位：姓名和岗位一行，下面一行条件词，留白与真的一行相同。 */
function RowSkeleton() {
	return (
		<ListViewRow aria-hidden="true">
			<div className="flex items-center gap-2">
				<Skeleton.Text className="w-auto shrink-0" size="sm" width="4em" />
				<Skeleton.Text className="min-w-0 flex-1" size="xs" width="40%" />
			</div>
			<Skeleton.Text className="mt-1" size="xs" width="48%" />
		</ListViewRow>
	);
}

export function ResultList({
	outcome,
	empId,
	wait,
	canMore,
	growing,
	onAll,
	onMore,
	spec,
	mode,
	turnId,
	onChange,
	onReviseQuery,
	onEditQuery,
	picks,
	failure = null,
}: {
	outcome: SearchOutcome;
	empId: string | undefined;
	/** 在等什么；null 是名单已经就位。 */
	wait: ListWait | null;
	canMore: boolean;
	growing: boolean;
	onAll: () => void;
	onMore: () => void;
	spec: SearchSpec;
	/** 这次搜索是对话还是关键词：空态的出路说法不一样。 */
	mode: SearchMode;
	turnId: string;
	onChange: (next: Partial<View>) => void;
	onReviseQuery: (next: Condition[]) => void;
	onEditQuery: () => void;
	picks: Picks;
	/** 这一轮没理解出来：名单停在这里，说出哪一环坏了。 */
	failure?: { fault: InterpretFault; onRetry: () => void } | null;
}) {
	const { results, claims, order, total } = outcome;
	const reach = reachOf(total);
	// 名单上有证据行，或这一轮的条件搜出来会有：图例才有点可对照
	const evidence = claims.length > 0 || claimsOf(spec.conditions).length > 0;
	const skeleton = useDelayed(wait?.list === "skeleton");
	// 等占位的那 200 毫秒里旧名单原样留着；没有旧名单时只有表头，空态不抢先闪出来
	const blank = skeleton || (wait?.list === "skeleton" && results.length === 0);

	const head = (
		<ListViewHeader
			pick={
				<Tooltip title={`全选这 ${results.length} 人`}>
					<Checkbox
						aria-label={`全选这 ${results.length} 人`}
						disabled={blank}
						parent
						size={18}
					/>
				</Tooltip>
			}
		>
			<ResultHeader
				evidence={evidence}
				order={order}
				phase={wait?.phase ?? null}
				total={total}
			/>
		</ListViewHeader>
	);

	// 按人排的名单没有主张，一行只有姓名和岗位
	const evidenced = claims.length > 0;
	const rows = picks.rows.map(({ employee: e, lines }) => {
		const current = e.empId === empId;
		return (
			<ListViewRow
				className={cn("scroll-my-12", wait?.list === "dim" && "opacity-60")}
				current={current}
				data-emp={e.empId}
				extra={evidenced && <ClaimProgress lines={lines} name={e.name} />}
				key={e.empId}
				pick={
					<Checkbox
						aria-label={`选择 ${e.name}`}
						onClick={(event) => {
							if (picks.pointAt(e.empId, event.shiftKey))
								event.preventBaseUIHandler();
						}}
						onPointerDown={(event) => {
							// 按着 Shift 按下时浏览器会把两次点击之间的字选中
							if (event.shiftKey) event.preventDefault();
						}}
						size={18}
						value={e.empId}
					/>
				}
			>
				<div className="flex items-baseline gap-2">
					<ListViewLink
						aria-current={current ? "page" : undefined}
						className="min-w-0 shrink-0"
						render={
							<Link
								params={{ turnId, empId: e.empId }}
								replace
								search={(prev) => prev}
								to="/s/$turnId/p/$empId"
							/>
						}
					>
						<Text ellipsis size="sm" weight="medium">
							{e.name}
						</Text>
					</ListViewLink>
					<Text className="min-w-0" ellipsis size="xs" type="secondary">
						{positionLabel(e)}
					</Text>
				</div>
				{evidenced && <ClaimRow lines={lines} />}
			</ListViewRow>
		);
	});

	const content = failure ? (
		<NotUnderstood fault={failure.fault} onRetry={failure.onRetry} />
	) : blank ? (
		<ListView aria-busy="true">
			{head}
			{skeleton &&
				Array.from({ length: SKELETON_ROWS }, (_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: 占位行只按位置区分
					<RowSkeleton key={i} />
				))}
		</ListView>
	) : results.length === 0 ? (
		<div
			aria-busy={wait ? "true" : undefined}
			className={cn("transition-opacity", wait?.list === "dim" && "opacity-60")}
		>
			<NoResults
				mode={mode}
				onChange={onChange}
				onEditQuery={onEditQuery}
				onReviseQuery={onReviseQuery}
				outcome={outcome}
				spec={spec}
			/>
		</div>
	) : (
		<div aria-busy={wait ? "true" : undefined}>
			<ListView>
				{head}
				{rows}
			</ListView>
			{total > RESULT_PAGE && (
				<div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 py-3">
					<span className="text-fg-secondary text-xs">
						已显示 <b className="tabular-nums">{results.length}</b> 人{"，共 "}
						<b className="tabular-nums">{total}</b> 人
					</span>
					{canMore ? (
						<Button loading={growing} onClick={onMore} size="small">
							再加载 {RESULT_PAGE} 人
						</Button>
					) : (
						<span className="text-fg-secondary text-xs">
							{total > reach
								? `仅显示匹配度最高的 ${reach} 人。添加条件可以缩小范围。`
								: "已显示全部结果。"}
						</span>
					)}
				</div>
			)}
		</div>
	);

	return (
		<CheckboxGroup
			allValues={picks.shownIds}
			aria-label="名单"
			onChange={picks.setShown}
			value={picks.shownPicked}
		>
			{content}
			<PickDock
				loading={growing}
				names={claims.map(claimName)}
				onAll={onAll}
				picks={picks}
				total={total}
			/>
		</CheckboxGroup>
	);
}
