import type { Ref } from "react";
import { KeywordBar, type KeywordBarHandle } from "#/components/keyword-bar";
import type { Condition } from "#/search/condition";
import type { Keywords } from "#/search/keywords";
import type { QueryCondition } from "#/search/query";
import type { Facets } from "#/search/result";
import { filterFields, textFilters } from "../-lib/filters";
import type { View } from "../-lib/view-params";
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
			/** 每条条件单独的人数，按 id */
			counts: Readonly<Record<string, number>>;
			onRevise: (conditions: QueryCondition[]) => boolean | Promise<boolean>;
	  }
	| {
			mode: "keyword";
			/** 框里的词；读不回框里的条件表为 null */
			keywords: Keywords | null;
			onSearch: (conditions: Condition[]) => boolean | Promise<boolean>;
			bar?: Ref<KeywordBarHandle>;
	  };

/** 名单上方那一组：正看着较早的一次时的提示、搜索条件、筛选。 */
export function WorkspaceNotices({
	earlier,
	latestId,
	turnId,
	conditions,
	facets,
	view,
	onViewChange,
}: {
	earlier: boolean;
	latestId: string;
	turnId: string;
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
			{conditions.mode === "conversation" ? (
				conditions.list.length > 0 && (
					<QueryChips
						conditions={conditions.list}
						counts={conditions.counts}
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
