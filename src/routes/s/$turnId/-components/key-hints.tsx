import { Hotkey } from "#/components/ui/hotkey";
import type { SearchMode } from "#/server/turn";

/** 「/」把光标放进改查询的地方：AI 搜索是右栏的输入框，关键词是「经历或技能」。 */
const EDIT_KEY = {
	conversation: ["/", "修改需求"],
	keyword: ["/", "改关键词"],
} as const;

const KEYS = [
	["up+down", "切换员工"],
	["esc", "关闭详情"],
] as const;

const PICK_KEY = ["space", "选择或取消"] as const;

/**
 * 名单下面的快捷键表脚，只在有精确指针（鼠标、触控板）的设备上出现。
 * `editable` 为假时这条链改不了查询（对话的链没配 AI 服务），不列「/」；
 * `picking` 时加上空格选择。按键本身由 `-lib/keyboard-flow.ts` 处理。
 */
export function KeyHints({
	mode,
	editable,
	picking,
}: {
	mode: SearchMode;
	editable: boolean;
	picking: boolean;
}) {
	return (
		<footer className="mx-auto hidden w-full max-w-page flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pb-8 text-fg-secondary text-xs pointer-fine:flex">
			{[
				...(editable ? [EDIT_KEY[mode]] : []),
				...KEYS,
				...(picking ? [PICK_KEY] : []),
			].map(([key, what]) => (
				<span className="flex items-center gap-1.5" key={key}>
					<Hotkey keys={key} />
					{what}
				</span>
			))}
		</footer>
	);
}
