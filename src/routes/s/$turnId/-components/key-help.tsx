import { Hotkey } from "#/components/ui/hotkey";
import { Modal } from "#/components/ui/modal";
import { Text } from "#/components/ui/text";
import type { SearchMode } from "#/server/turn";

type Key = { keys: string; title: string; desc: string };

/** 「/」把光标放进改查询的地方：AI 搜索是右栏的输入框，关键词是「经历或技能」。 */
const EDIT_KEY: Record<SearchMode, Key> = {
	conversation: {
		desc: "光标移到右栏的输入框",
		keys: "/",
		title: "修改需求",
	},
	keyword: {
		desc: "光标移到「经历或技能」",
		keys: "/",
		title: "改关键词",
	},
};

const KEYS: Key[] = [
	{ desc: "也可以按 J、K", keys: "up+down", title: "切换员工" },
	{ desc: "选中或取消正在看的这个人", keys: "space", title: "选择或取消" },
	{
		desc: "按住 Shift 点选择框，选中上次点过的人到这个人之间的所有人",
		keys: "shift",
		title: "连续选择",
	},
	{ desc: "没有打开详情时，清空已选的人", keys: "esc", title: "关闭详情" },
	{ desc: "打开这张列表", keys: "?", title: "快捷键" },
];

/**
 * 快捷键列表，按「?」打开。一列排下来，行与行相隔 32px，上下各留 24px；每一行左边是
 * 做什么和一句说明（12px 三级灰），右边是填充的键帽。
 * `editable` 为假时这条链改不了查询（对话的链没配 AI 服务），不列「/」。
 * 按键本身由 `-lib/keyboard-flow.ts` 处理。
 */
export function KeyHelp({
	mode,
	editable,
	open,
	onClose,
}: {
	mode: SearchMode;
	editable: boolean;
	open: boolean;
	onClose: () => void;
}) {
	return (
		<Modal noFooter onCancel={onClose} open={open} title="快捷键">
			<div className="flex flex-col gap-8 pt-6 pb-2">
				{[...(editable ? [EDIT_KEY[mode]] : []), ...KEYS].map((key) => (
					<div className="flex items-start gap-4" key={key.title}>
						<div className="flex min-w-0 flex-1 flex-col gap-1">
							<Text>{key.title}</Text>
							<Text size="xs" type="tertiary">
								{key.desc}
							</Text>
						</div>
						<Hotkey keys={key.keys} size="large" />
					</div>
				))}
			</div>
		</Modal>
	);
}
