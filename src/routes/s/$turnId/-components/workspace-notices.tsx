import type { Ref } from "react";
import { KeywordBar, type KeywordBarHandle } from "#/components/keyword-bar";
import type { Condition } from "#/search/condition";
import type { Incomplete } from "#/search/empty";
import type { Keywords } from "#/search/keywords";
import type { QueryCondition } from "#/search/query";
import type { Facets } from "#/search/result";
import type { AttemptFault } from "#/server/turn";
import { filterFields, textFilters } from "../-lib/filters";
import type { View } from "../-lib/view-params";
import { IncompleteNotice, NotCompleted } from "./completeness";
import { Earlier } from "./earlier";
import { FilterBar } from "./filter-bar";
import { QueryChips } from "./query-chips";

/**
 * 搜索条件那一行，按这条链的种类：对话的条件在 chip 上改；关键词的条件就在框里，不另排一行。
 */
type ConditionsRow =
	| {
			mode: "conversation";
			list: readonly QueryCondition[];
			onRevise: (conditions: QueryCondition[]) => boolean | Promise<boolean>;
	  }
	| {
			mode: "keyword";
			/** 框里的词；读不回框里的条件表为 null */
			keywords: Keywords | null;
			onSearch: (conditions: Condition[]) => boolean | Promise<boolean>;
			bar?: Ref<KeywordBarHandle>;
	  };

/**
 * 名单上方那一组：正看着较早的一次时的提示、名单还不完整时的说明、搜索条件、筛选。
 */
export function WorkspaceNotices({
	earlier,
	latestId,
	turnId,
	incomplete,
	notCompleted,
	conditions,
	facets,
	view,
	onViewChange,
}: {
	earlier: boolean;
	latestId: string;
	turnId: string;
	/** 候选人较多、名单还不完整时覆盖到了哪里；名单完整、是空的、或还在补人时为 null。 */
	incomplete: Incomplete | null;
	/** 改完条件后新进范围的人没能补上、名单上已有人：哪个环节出了问题；没有出错为 null。 */
	notCompleted: { fault: AttemptFault; onRetry: () => void } | null;
	conditions: ConditionsRow;
	facets: Facets;
	view: View;
	onViewChange: (next: Partial<View>) => void;
}) {
	const fields = filterFields(facets, view);
	const texts = textFilters(view);
	// 数得出人的维、或者生效的文本条件，至少有一样才有东西可筛
	const filtering =
		fields.some((f) => f.options.length > 0) || texts.length > 0;

	return (
		<>
			{earlier && <Earlier latestId={latestId} />}
			{notCompleted ? (
				<NotCompleted {...notCompleted} />
			) : (
				incomplete && <IncompleteNotice incomplete={incomplete} />
			)}
			{conditions.mode === "conversation" ? (
				conditions.list.length > 0 && (
					<QueryChips
						conditions={conditions.list}
						onChange={conditions.onRevise}
					/>
				)
			) : (
				<KeywordBar
					initial={conditions.keywords ?? undefined}
					key={turnId}
					onSearch={conditions.onSearch}
					ref={conditions.bar}
				/>
			)}
			{filtering && (
				<FilterBar
					fields={fields}
					onChange={onViewChange}
					textFilters={texts}
				/>
			)}
		</>
	);
}
