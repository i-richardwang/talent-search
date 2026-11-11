import { RotateCwIcon, UsersIcon } from "lucide-react";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import type { Incomplete } from "#/search/empty";
import type { AttemptFault } from "#/server/turn";
import { FAULT_COPY, FAULT_EXIT_LABEL } from "../-lib/attempt";
import { coverMore } from "../-lib/empty-state";

/** 候选人较多时名单覆盖到了哪里，写成一句话。 */
export function incompleteText(incomplete: Incomplete) {
	const reach = incomplete.above
		? `当前名单从高职级起完整覆盖到 ${incomplete.above}`
		: "当前名单还不完整";
	return `候选人较多，${reach}。${coverMore(incomplete)}`;
}

/**
 * 候选人较多，名单还不完整。名单从职级高的人起确认，这里说清现在完整覆盖到哪一档；
 * 想覆盖到更低的职级，下一步是把需求说得更具体。
 */
export function IncompleteNotice({ incomplete }: { incomplete: Incomplete }) {
	return (
		<Alert icon={UsersIcon} title={incompleteText(incomplete)} type="info" />
	);
}

/**
 * 改完条件之后，新进范围的人没能补上。名单上已有的人仍然成立，所以名单照常显示；
 * 这里说出哪个环节出了问题（`FAULT_COPY`），给重试。名单上一个人都没有时不用它，
 * 失败说在名单那一列（`result-state.tsx` 的 `ListFailed`）。
 */
export function NotCompleted({
	fault,
	onRetry,
}: {
	fault: AttemptFault;
	onRetry: () => void;
}) {
	const copy = FAULT_COPY[fault];
	return (
		<Alert
			action={
				copy.retry && (
					<Button icon={RotateCwIcon} onClick={onRetry} size="small">
						{FAULT_EXIT_LABEL.retry}
					</Button>
				)
			}
			title={`名单可能不完整：${copy.title}`}
			type="warning"
		/>
	);
}
