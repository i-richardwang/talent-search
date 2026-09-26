import { Divider } from "#/components/ui/divider";
import type { SearchSpec } from "#/search/spec";
import { QueryChips } from "./query-chips";

/**
 * 吸顶的那条：这次找人任务叫什么，以及对话时现在的整张条件表。
 *
 * 对话的标题是链头那句话，不跟着每一轮变：后面每一句都是在它上面改，这一轮说了
 * 什么、改了什么写在右栏线程里那一轮底下（`thread.tsx`）。条件表是查询的全部，
 * 模型改的和用户在 chip 上改的是它，所以它常驻在视线最上沿。
 * 这一轮还没理解完时这里只有标题：理解到哪了在线程里，名单那一列是等待态，
 * 这里再说一遍就是同一件事画三处。
 *
 * 关键词搜索的标题是框里的词（`keywordTitle`），没有 chip：词就在名单上方的框里，
 * 改也在那里改，这里再摆一排能点的 chip 就是同一样东西画两遍、改两处。
 */
export function QueryDeck({
	title,
	spec,
	onChangeSpec,
}: {
	title: string | null;
	/** null 表示这一轮还没整理完。 */
	spec: SearchSpec | null;
	/** 在 chip 上改条件。关键词搜索不给：它的条件在框里改。 */
	onChangeSpec?: (next: SearchSpec) => void;
}) {
	const conditions = spec?.conditions ?? [];
	return (
		<header className="sticky top-(--header-height) z-stick min-h-(--deck-height) border-b bg-layout/80 backdrop-blur-sm lg:h-(--deck-height)">
			<div className="app-column flex h-full flex-wrap items-center gap-x-2 gap-y-1.5 py-1.5 lg:flex-nowrap lg:overflow-hidden lg:py-0">
				<h1
					className="min-w-0 shrink truncate font-medium text-base"
					title={title ?? undefined}
				>
					{title ?? "搜索条件"}
				</h1>
				{onChangeSpec && conditions.length > 0 && (
					<>
						<Divider className="max-lg:hidden" orientation="vertical" />
						<div className="flex shrink-0 items-center gap-1.5 max-lg:flex-wrap">
							<QueryChips
								conditions={conditions}
								onChange={(next) => onChangeSpec({ conditions: next })}
							/>
						</div>
					</>
				)}
			</div>
		</header>
	);
}
