import { useNavigate } from "@tanstack/react-router";
import { MessageSquareTextIcon, TextSearchIcon } from "lucide-react";
import { ChatInputAction } from "#/components/ui/chat-input";
import { ChoiceMenu, type ChoiceMenuOption } from "#/components/ui/choice-menu";
import type { SearchMode } from "#/server/turn";

/** 两种搜索各自的图标与一句说明；图标和导航栏最近搜索里两种记录的图标是同一对。 */
const MODES: Record<SearchMode, ChoiceMenuOption<SearchMode>> = {
	conversation: {
		desc: "用一句话描述要找的人",
		icon: MessageSquareTextIcon,
		label: "AI 搜索",
		value: "conversation",
	},
	keyword: {
		desc: "按经历、公司、学校逐项搜",
		icon: TextSearchIcon,
		label: "关键词搜索",
		value: "keyword",
	},
};

/**
 * 首页输入托盘动作栏左端的搜索方式：按钮上写着当前是哪一种，点开是两种的菜单。
 *
 * 两种各是一个起点，切过去是从头开一次新的搜索：选中的是哪一种由地址上的 `mode`
 * 决定，切换就是带着新的 `mode` 回首页。两种的托盘同高、按钮在同一个位置，换过去
 * 标题和托盘都不动。
 */
export function ModeSelect({ mode }: { mode: SearchMode }) {
	const navigate = useNavigate();
	const current = MODES[mode];
	return (
		<ChoiceMenu
			onValueChange={(next) =>
				void navigate({
					search: next === "keyword" ? { mode: "keyword" } : {},
					to: "/",
				})
			}
			options={Object.values(MODES)}
			value={mode}
		>
			<ChatInputAction
				aria-label={`搜索方式：${current.label}`}
				chevron
				icon={current.icon}
			>
				{current.label}
			</ChatInputAction>
		</ChoiceMenu>
	);
}
