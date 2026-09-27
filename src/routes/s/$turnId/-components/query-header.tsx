import { KeyboardIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { PageHeader } from "../../../-components/page-header";

/**
 * 名单那一栏的页头：写这次找人任务叫什么。条件那一排在名单上方（`QueryChips`），
 * 和名单一起滚。
 *
 * 对话的标题是链头那句话，不跟着每一轮变：后面每一句都是在它上面改，这一轮说了
 * 什么、改了什么写在右栏线程里那一轮底下（`thread.tsx`）。关键词搜索的标题是框里的词
 * （`keywordTitle`）。这一轮还没理解完时标题写「搜索条件」。
 *
 * 页头右端有一个打开快捷键列表的按钮，只在有精确指针（鼠标、触控板）的设备上出现：
 * 快捷键要有键盘才用得上。
 */
export function QueryHeader({
	title,
	onHelp,
	right,
}: {
	title: string | null;
	/** 打开快捷键列表。 */
	onHelp?: () => void;
	/** 页头右端的动作：窄屏上打开对话的按钮。 */
	right?: ReactNode;
}) {
	return (
		<PageHeader
			right={
				<>
					{onHelp && (
						<ActionIcon
							aria-label="快捷键"
							className="hidden pointer-fine:inline-flex"
							icon={KeyboardIcon}
							onClick={onHelp}
							size="header"
							title="快捷键"
							tooltipProps={{ hotkey: "?" }}
						/>
					)}
					{right}
				</>
			}
			title={title ?? "搜索条件"}
		/>
	);
}
