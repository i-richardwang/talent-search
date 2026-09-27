import { MessageSquareTextIcon, TextSearchIcon } from "lucide-react";
import { useState } from "react";
import { ChatInputAction } from "#/components/ui/chat-input";
import { ChoiceMenu, type ChoiceMenuOption } from "#/components/ui/choice-menu";
import { DocPage } from "../../kit/page";
import { Stage } from "../../kit/stage";

type Mode = "conversation" | "keyword";

const MODES: ChoiceMenuOption<Mode>[] = [
	{
		desc: "用一句话描述要找的人",
		icon: MessageSquareTextIcon,
		label: "AI 搜索",
		value: "conversation",
	},
	{
		desc: "按经历、公司、学校逐项搜",
		icon: TextSearchIcon,
		label: "关键词搜索",
		value: "keyword",
	},
];

function Playground() {
	const [mode, setMode] = useState<Mode>("conversation");
	const current = MODES.find((m) => m.value === mode);
	return (
		<Stage footer={<span>选中：{current?.label}</span>}>
			<ChoiceMenu onValueChange={setMode} options={MODES} value={mode}>
				<ChatInputAction chevron icon={current?.icon}>
					{current?.label}
				</ChatInputAction>
			</ChoiceMenu>
		</Stage>
	);
}

/** 几选一菜单页：首页托盘上的搜索方式。 */
export function ChoiceMenuPage() {
	return (
		<DocPage
			facts={["每项一句说明", "选中项铺底"]}
			rules={{
				notes: [
					"每一项都要解释一句的几选一用 ChoiceMenu；只有名字的单选用下拉菜单的单选项。",
					"项是一张小卡：32px 描边方块里的图标，名字 14px，说明 12px 一行截断；选中的铺底，不画勾。",
					"触发器通常是输入托盘动作栏上的 ChatInputAction，写着当前选的是哪一项。",
				],
				usage: `<ChoiceMenu onValueChange={setMode} options={MODES} value={mode}>\n  <ChatInputAction chevron icon={current.icon}>\n    {current.label}\n  </ChatInputAction>\n</ChoiceMenu>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用几选一菜单" },
			]}
		/>
	);
}
