import { useNavigate } from "@tanstack/react-router";
import { Segmented } from "#/components/ui/segmented";
import type { SearchMode } from "#/server/turn";

const OPTIONS = [
	{ label: "AI 搜索", value: "conversation" },
	{ label: "关键词搜索", value: "keyword" },
] satisfies { label: string; value: SearchMode }[];

/**
 * 两种搜索的切换：对话和关键词，摆在首页输入面的上方。
 *
 * 两种各是一个起点，切过去是从头开一次新的搜索：选中的是哪一种由地址上的
 * `mode` 决定，切换就是带着新的 `mode` 回首页。
 */
export function ModeNav({ mode }: { mode: SearchMode }) {
	const navigate = useNavigate();
	return (
		<Segmented<SearchMode>
			aria-label="搜索方式"
			onChange={(next) =>
				void navigate({
					search: next === "keyword" ? { mode: "keyword" } : {},
					to: "/",
				})
			}
			options={OPTIONS}
			value={mode}
		/>
	);
}
