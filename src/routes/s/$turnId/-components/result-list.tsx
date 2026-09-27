import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { EvidenceLine, MissedClaims } from "#/components/evidence";
import { Block, BlockLink } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox, CheckboxGroup } from "#/components/ui/checkbox";
import { Skeleton } from "#/components/ui/skeleton";
import { Text } from "#/components/ui/text";
import { Tooltip } from "#/components/ui/tooltip";
import { positionLabel } from "#/lib/format";
import { cn } from "#/lib/utils";
import type { Condition } from "#/search/condition";
import { conditionKey } from "#/search/condition";
import { claimName } from "#/search/condition-label";
import { claimsOf, type SearchOutcome } from "#/search/result";
import type { SearchSpec } from "#/search/spec";
import { RESULT_PAGE } from "#/search/weights";
import type { InterpretFault, SearchMode } from "#/server/turn";
import type { Picks } from "../-lib/picks";
import { reachOf, type View } from "../-lib/view-params";
import { PickDock } from "./pick-dock";
import {
	NoResults,
	NotUnderstood,
	ResultHeader,
	type SearchPhase,
} from "./result-state";

/**
 * 名单在等什么、等的时候长什么样。`dim`：改了筛选，旧名单还是这批候选，留在原地
 * 调到六成；`skeleton`：换了问题或第一次进来，旧名单不再成立，换成同形的占位行。
 */
export type ListWait = { phase: SearchPhase; list: "dim" | "skeleton" };

/** 占位等过这么久才出现：更快回来的等待里旧画面原样留着，不闪一下占位。 */
const SKELETON_DELAY = 200;

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

/** 名单左边那一列复选框，在块外：勾上第一个就开始选。 */
function PickCell({ children }: { children?: ReactNode }) {
	return <div className="w-(--pick-column) shrink-0">{children}</div>;
}

/** 名单一行的占位：姓名和岗位一行，两行证据，留白与真的一行相同。 */
function RowSkeleton() {
	return (
		<li aria-hidden="true" className="flex">
			<PickCell />
			<div className="min-w-0 flex-1 p-3">
				<div className="flex items-center gap-2.5">
					<Skeleton.Text className="w-auto shrink-0" size="base" width="4em" />
					<Skeleton.Text className="min-w-0 flex-1" size="sm" width="50%" />
				</div>
				<div className="mt-1.5 space-y-1">
					<Skeleton.Text size="sm" width="72%" />
					<Skeleton.Text size="sm" width="56%" />
				</div>
			</div>
		</li>
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
		<div className="mb-2 flex items-center">
			<PickCell>
				<Tooltip title={`全选这 ${results.length} 人`}>
					<Checkbox
						aria-label={`全选这 ${results.length} 人`}
						className="ms-1"
						disabled={blank}
						parent
					/>
				</Tooltip>
			</PickCell>
			<ResultHeader
				className="px-3"
				evidence={evidence}
				order={order}
				phase={wait?.phase ?? null}
				total={total}
			/>
		</div>
	);

	const rows = (
		<ul
			className={cn(
				"flex flex-col gap-0.5 transition-opacity",
				wait?.list === "dim" && "opacity-60",
			)}
		>
			{picks.rows.map(({ employee: e, hits, missed }) => {
				const selected = e.empId === empId;
				return (
					<li className="flex" key={e.empId}>
						<PickCell>
							<Checkbox
								aria-label={`选择 ${e.name}`}
								className="ms-1 mt-3.5"
								onClick={(event) => {
									if (picks.pointAt(e.empId, event.shiftKey))
										event.preventBaseUIHandler();
								}}
								onPointerDown={(event) => {
									// 按着 Shift 按下时浏览器会把两次点击之间的字选中
									if (event.shiftKey) event.preventDefault();
								}}
								value={e.empId}
							/>
						</PickCell>
						<Block
							allowShrink
							className="scroll-my-2"
							clickable
							data-emp={e.empId}
							flex={1}
							padding={12}
							variant={selected ? "filled" : "borderless"}
						>
							<div className="flex items-baseline gap-2.5">
								<BlockLink
									aria-current={selected ? "page" : undefined}
									className="min-w-0 shrink-0 text-fg"
									render={
										<Link
											params={{ turnId, empId: e.empId }}
											replace
											search={(prev) => prev}
											to="/s/$turnId/p/$empId"
										/>
									}
								>
									<Text ellipsis size="base" weight="semibold">
										{e.name}
									</Text>
								</BlockLink>
								<Text className="min-w-0" ellipsis size="sm" type="tertiary">
									{positionLabel(e)}
								</Text>
							</div>
							{claims.length > 0 && (
								<div className="mt-1.5 space-y-1">
									{hits.map(({ claim, name, hit, basis }) => (
										<EvidenceLine
											basis={basis}
											boost={claim.mode === "boost"}
											hit={hit}
											key={conditionKey(claim)}
											name={name}
										/>
									))}
									<MissedClaims names={missed} />
								</div>
							)}
						</Block>
					</li>
				);
			})}
		</ul>
	);

	const content = failure ? (
		<NotUnderstood fault={failure.fault} onRetry={failure.onRetry} />
	) : blank ? (
		<div aria-busy="true">
			{head}
			{skeleton && (
				<ul className="flex flex-col gap-0.5">
					{Array.from({ length: SKELETON_ROWS }, (_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: 占位行只按位置区分
						<RowSkeleton key={i} />
					))}
				</ul>
			)}
		</div>
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
			{head}
			{rows}
			{total > RESULT_PAGE && (
				<div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 py-6">
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
