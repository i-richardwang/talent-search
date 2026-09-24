import { AlertCircleIcon, RotateCwIcon } from "lucide-react";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Separator } from "#/components/ui/separator";
import type { SearchSpec } from "#/search/spec";
import { QueryChips } from "./query-chips";

/**
 * 吸顶的那条：这次找人任务叫什么，以及对话时现在的整张条件表。
 *
 * 对话的标题是链头那句话，不跟着每一轮变：后面每一句都是在它上面改，这一轮说了
 * 什么、改了什么写在右栏线程里那一轮底下（`thread.tsx`）。条件表是查询的全部，
 * 模型改的和用户在 chip 上改的是它，所以它常驻在视线最上沿。
 *
 * 关键词搜索的标题是框里的词（`keywordTitle`），没有 chip：词就在名单上方的框里，
 * 改也在那里改，这里再摆一排能点的 chip 就是同一样东西画两遍、改两处。
 */
export function QueryDeck({
	title,
	spec,
	onChangeSpec,
	interpreting,
	error,
	onRetry,
}: {
	title: string | null;
	/** null 表示这一轮还没整理完。 */
	spec: SearchSpec | null;
	/** 在 chip 上改条件。关键词搜索不给：它的条件在框里改。 */
	onChangeSpec?: (next: SearchSpec) => void;
	interpreting: boolean;
	error: string | null;
	onRetry?: () => void;
}) {
	const conditions = spec?.conditions ?? [];
	const chips = onChangeSpec !== undefined;

	return (
		<header className="sticky top-(--header-height) z-stick min-h-(--deck-height) bg-canvas/80 backdrop-blur-sm before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border/64 lg:h-(--deck-height)">
			<div className="app-column flex h-full flex-wrap items-center gap-x-2 gap-y-1.5 py-1.5 lg:flex-nowrap lg:overflow-hidden lg:py-0">
				<h1
					className="min-w-0 shrink truncate font-medium text-sm"
					title={title ?? undefined}
				>
					{title ?? "搜索条件"}
				</h1>
				{chips && (interpreting || conditions.length > 0) && (
					<Separator className="h-4 max-lg:hidden" orientation="vertical" />
				)}
				{interpreting ? (
					<span
						className="shrink-0 text-muted-foreground text-xs"
						role="status"
					>
						正在整理条件…
					</span>
				) : (
					chips && (
						<div className="flex shrink-0 items-center gap-1.5 max-lg:flex-wrap">
							<QueryChips
								conditions={conditions}
								onChange={(next) => onChangeSpec({ conditions: next })}
							/>
						</div>
					)
				)}
			</div>

			{error && (
				<div className="absolute inset-x-0 top-full bg-canvas pt-2 pb-3 before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border/64">
					<div className="app-column">
						<div className="max-w-page">
							<Failure error={error} onRetry={onRetry} />
						</div>
					</div>
				</div>
			)}
		</header>
	);
}

function Failure({ error, onRetry }: { error: string; onRetry?: () => void }) {
	return (
		<Alert variant="error">
			<AlertCircleIcon />
			<AlertDescription className="flex items-baseline gap-2">
				<span className="min-w-0 flex-1">{error}</span>
				{onRetry && (
					<Button
						className="shrink-0"
						onClick={onRetry}
						size="xs"
						variant="link"
					>
						<RotateCwIcon />
						重试
					</Button>
				)}
			</AlertDescription>
		</Alert>
	);
}
