import type { ReactNode } from "react";
import type { SearchSpec } from "#/search/spec";
import { PageHeader } from "../../../-components/page-header";
import { QueryChips } from "./query-chips";

/**
 * 名单那一栏的抬头：页头写这次找人任务叫什么，对话时下面一行是现在的整张条件表。
 *
 * 对话的标题是链头那句话，不跟着每一轮变：后面每一句都是在它上面改，这一轮说了
 * 什么、改了什么写在右栏线程里那一轮底下（`thread.tsx`）。条件表是查询的全部，
 * 模型改的和用户在 chip 上改的是它，所以它在名单上方常驻、不随名单滚走。
 * 这一轮还没理解完时这里只有标题：理解到哪了在线程里，名单那一列是等待态。
 *
 * 关键词搜索的标题是框里的词（`keywordTitle`），没有 chip：词就在名单上方的框里，
 * 改也在那里改。
 */
export function QueryHeader({
	title,
	spec,
	onChangeSpec,
	right,
}: {
	title: string | null;
	/** null 表示这一轮还没整理完。 */
	spec: SearchSpec | null;
	/** 在 chip 上改条件。关键词搜索不给：它的条件在框里改。 */
	onChangeSpec?: (next: SearchSpec) => void;
	/** 页头右端的动作：窄屏上打开对话的按钮。 */
	right?: ReactNode;
}) {
	const conditions = spec?.conditions ?? [];
	return (
		<>
			<PageHeader right={right} title={title ?? "搜索条件"} />
			{onChangeSpec && conditions.length > 0 && (
				<div className="flex flex-none flex-wrap items-center gap-1.5 px-3 pb-2">
					<QueryChips
						conditions={conditions}
						onChange={(next) => onChangeSpec({ conditions: next })}
					/>
				</div>
			)}
		</>
	);
}
