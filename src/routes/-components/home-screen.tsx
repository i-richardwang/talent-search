import type { QueryInput } from "#/search/spec";
import type { SearchMode } from "#/server/turn";
import { ModeNav } from "./mode-nav";
import { ZeroState } from "./zero-state";

/**
 * 首页的正文。开哪种搜索由地址上的 `mode`（`asked`）和 AI 服务配没配共同决定：
 * 配了时默认 AI 搜索，地址说 `keyword` 才是关键词；没配时只有关键词，也不给切换。
 *
 * 这一屏的正文就是那块输入面，它自己就是 `<main>`：没有名单、没有筛选，
 * 也就没有第二块需要和它区分开的东西。换模式时整屏重来，敲到一半的字不带过去。
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
		<main className="flex flex-1 flex-col" id="main" tabIndex={-1}>
			<ZeroState
				error={error}
				key={mode}
				mode={mode}
				nav={understanding && <ModeNav mode={mode} />}
				onQuery={onQuery}
			/>
		</main>
	);
}
