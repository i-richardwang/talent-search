import { Link } from "@tanstack/react-router";
import { AppHome } from "#/components/ui/app-layout";
import {
	GroupBlock,
	GroupBlockAction,
	GroupBlockItem,
} from "#/components/ui/group-block";
import type { QueryInput } from "#/search/spec";
import type { SearchMode } from "#/server/turn";
import {
	ago,
	HOME_RECENT_COUNT,
	recentLabel,
	recentSummary,
} from "../-lib/recent";
import { useRecents } from "../-lib/recents";
import { ModeSelect } from "./mode-select";
import { useNavControl } from "./nav-control";
import { PageHeader } from "./page-header";
import { LoadFailed, recentIcon } from "./recent-item";
import { ZeroState } from "./zero-state";

/**
 * 首页的正文。开哪种搜索由地址上的 `mode`（`asked`）和 AI 服务配没配共同决定：
 * 配了时默认 AI 搜索，地址说 `keyword` 才是关键词；没配时只有关键词，也不给切换。
 * 换模式时正文整列重来，写到一半的字不带过去。输入面下面是最近搜索，一条记录都还没有
 * 时放起步的例子。
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
	const { page: recent } = useRecents();
	const mode: SearchMode =
		understanding && asked !== "keyword" ? "conversation" : "keyword";
	return (
		<ZeroState
			error={error}
			key={mode}
			layout={(parts) => (
				<AppHome
					header={<PageHeader title={null} />}
					input={parts.input}
					title="想找什么样的人？"
				>
					{recent === null || recent.total > 0 ? (
						<RecentBlock />
					) : (
						parts.starters
					)}
				</AppHome>
			)}
			mode={mode}
			modeSelect={understanding && <ModeSelect mode={mode} />}
			onQuery={onQuery}
		/>
	);
}

/** 首页的最近搜索；列不完时「查看全部」打开全部记录的抽屉。 */
function RecentBlock() {
	const control = useNavControl();
	const { page: recent, reload } = useRecents();
	const shown = recent?.rows.slice(0, HOME_RECENT_COUNT) ?? [];
	return (
		<GroupBlock
			action={
				recent &&
				recent.total > shown.length && (
					<GroupBlockAction onClick={control?.openAllRecents}>
						查看全部
					</GroupBlockAction>
				)
			}
			title="最近搜索"
		>
			{recent === null ? (
				<LoadFailed onRetry={reload} />
			) : (
				shown.map((record) => (
					<GroupBlockItem
						description={recentSummary(record)}
						extra={<span title={record.at}>{ago(record)}</span>}
						icon={recentIcon(record)}
						key={record.turnId}
						loading={record.status === "working"}
						render={<Link params={{ turnId: record.turnId }} to="/s/$turnId" />}
						title={recentLabel(record)}
					/>
				))
			)}
		</GroupBlock>
	);
}
