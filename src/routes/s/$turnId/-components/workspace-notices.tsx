import type { Ref } from "react";
import { KeywordBar, type KeywordBarHandle } from "#/components/keyword-bar";
import type { Condition } from "#/search/condition";
import type { Keywords } from "#/search/keywords";
import type { QueryCondition } from "#/search/query";
import type { Facets } from "#/search/result";
import type { SearchMode } from "#/server/turn";
import { filterFields, textFilters } from "../-lib/filters";
import type { View } from "../-lib/view-params";
import { Earlier } from "./earlier";
import { FilterBar } from "./filter-bar";
import { QueryChips } from "./query-chips";

/**
 * 名单上方那一组：正看着较早的一次时的提示、搜索条件、筛选。对话的条件在 chip 上改；
 * 关键词的条件就在框里，不另排一行。
 */
export function WorkspaceNotices({
	earlier,
	latestId,
	turnId,
	mode,
	conditions,
	counts,
	keywords,
	onRevise,
	onKeywords,
	keywordBar,
	facets,
	view,
	onViewChange,
}: {
	earlier: boolean;
	latestId: string;
	turnId: string;
	mode: SearchMode;
	conditions: readonly QueryCondition[];
	/** 每条条件单独的人数，按 id */
	counts: Readonly<Record<string, number>>;
	/** 关键词链框里的词；对话链为 null */
	keywords: Keywords | null;
	onRevise: (conditions: QueryCondition[]) => boolean | Promise<boolean>;
	onKeywords: (conditions: Condition[]) => boolean | Promise<boolean>;
	keywordBar?: Ref<KeywordBarHandle>;
	facets: Facets;
	view: View;
	onViewChange: (next: Partial<View>) => void;
}) {
	const fields = filterFields(facets, view);
	const texts = textFilters(view);
	// 数得出人的维、或者生效的文本条件，至少有一样才有东西可筛
	const filtering =
		fields.some((f) => f.options.length > 0) || texts.length > 0;
	const chips = mode === "conversation" && conditions.length > 0;

	return (
		<>
			{earlier && <Earlier latestId={latestId} />}
			{chips && (
				<QueryChips
					conditions={conditions}
					counts={counts}
					onChange={onRevise}
				/>
			)}
			{mode === "keyword" && (
				<KeywordBar
					initial={keywords ?? undefined}
					key={turnId}
					onSearch={onKeywords}
					ref={keywordBar}
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
