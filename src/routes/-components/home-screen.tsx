import { ScrollArea } from "#/components/ui/scroll-area";
import type { QueryInput } from "#/search/spec";
import type { SearchMode } from "#/server/turn";
import { ModeNav } from "./mode-nav";
import { PageHeader } from "./page-header";
import { ZeroState } from "./zero-state";

/**
 * 首页的正文。开哪种搜索由地址上的 `mode`（`asked`）和 AI 服务配没配共同决定：
 * 配了时默认 AI 搜索，地址说 `keyword` 才是关键词；没配时只有关键词，也不给切换。
 *
 * 页头不写标题：这一屏的标题是正文里那句问句。正文是居中的一列，换模式时整列
 * 重来，敲到一半的字不带过去。
 */
export function HomeScreen({
	understanding,
	asked,
	error,
	onQuery,
}: {
	understanding: boolean;
	asked: "keyword" | undefined;
	error: string | null;
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
}) {
	const mode: SearchMode =
		understanding && asked !== "keyword" ? "conversation" : "keyword";
	return (
		<>
			<PageHeader title={null} />
			<ScrollArea className="min-h-0 flex-1" disableContentFit>
				<main id="main" tabIndex={-1}>
					<ZeroState
						error={error}
						key={mode}
						mode={mode}
						nav={understanding && <ModeNav mode={mode} />}
						onQuery={onQuery}
					/>
				</main>
			</ScrollArea>
		</>
	);
}
