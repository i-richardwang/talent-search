import { RotateCwIcon, UsersIcon } from "lucide-react";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import type { Incomplete } from "#/search/empty";
import type { AttemptFault } from "#/server/turn";
import { FAULT_COPY, FAULT_EXIT_LABEL } from "../-lib/attempt";
import { CONTINUE_LABEL, NARROW } from "../-lib/empty-state";

/** 符合的人较多时名单列到了哪里，写成一句话。 */
export function incompleteText(incomplete: Incomplete) {
	const listed = incomplete.above
		? `已列出 ${incomplete.above} 及以上的`
		: "名单还没列全";
	return `符合的人较多，${listed}。${NARROW}`;
}

/**
 * 符合的人较多，名单还没列全。名单从职级高的人列起，这里说清现在列到哪一档；句子里说的
 * 下一步是补充条件，按钮是条件不变接着往下找（`onContinue`，没有谁能接着找时不给），
 * 按下之后到换去新的一轮之前停在等待态。
 */
export function IncompleteNotice({
	incomplete,
	onContinue,
}: {
	incomplete: Incomplete;
	onContinue?: () => unknown;
}) {
	return (
		<Alert
			action={
				onContinue && (
					<Button onClick={onContinue} size="small">
						{CONTINUE_LABEL}
					</Button>
				)
			}
			icon={UsersIcon}
			title={incompleteText(incomplete)}
			type="info"
		/>
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
	onRetry: () => unknown;
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
