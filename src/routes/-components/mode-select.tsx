import { useNavigate } from "@tanstack/react-router";
import {
	type LucideIcon,
	MessageSquareTextIcon,
	TextSearchIcon,
} from "lucide-react";
import { ChatInputAction } from "#/components/ui/chat-input";
import { ChoiceMenu, type ChoiceMenuOption } from "#/components/ui/choice-menu";
import type { SearchMode } from "#/server/turn";

/** 两种搜索各自的图标，最近搜索里两种记录也用这一对。 */
export const SEARCH_MODE_ICON: Record<SearchMode, LucideIcon> = {
	conversation: MessageSquareTextIcon,
	keyword: TextSearchIcon,
};

const MODES: Record<SearchMode, ChoiceMenuOption<SearchMode>> = {
	conversation: {
		desc: "用一句话描述要找的人",
		icon: SEARCH_MODE_ICON.conversation,
		label: "AI 搜索",
		value: "conversation",
	},
	keyword: {
		desc: "按经历、公司、学校逐项搜",
		icon: SEARCH_MODE_ICON.keyword,
		label: "关键词搜索",
		value: "keyword",
	},
};

/**
 * 首页输入托盘动作栏左端的搜索方式。选中哪一种由地址上的 `mode` 决定，切换就是带着
 * 新的 `mode` 回首页，从头开一次新的搜索。
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
				variant="mode"
			>
				{current.label}
			</ChatInputAction>
		</ChoiceMenu>
	);
}
