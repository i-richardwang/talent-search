import { KeyboardIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { PageHeader } from "../../../-components/page-header";

/**
 * 名单那一栏的页头：写这次找人任务叫什么。对话的标题是链头那句话，不跟着每一轮变；
 * 关键词搜索的标题是框里的词。还没有标题时写「搜索条件」。
 *
 * 快捷键按钮只在有精确指针的设备上出现：快捷键要有键盘才用得上。
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
