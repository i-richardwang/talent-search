import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "./icon";
import { Tooltip } from "./tooltip";

/*
 * 挂在一条回复下面的一列可点建议，样式在 suggestion-chips.css：一枚一行、最宽 460px，
 * 间隔 6px。每枚是三级填充的底、8px 圆角，字 13px 正文色；前面 14px 的图标平时半透明，
 * 悬停时换主色、不透明，底加深一档。出现时逐枚从下方 8px 浮上来，每枚晚 60ms。
 * 一行放不下时省略，悬停提示整句。
 */

export interface Suggestion {
	key: string;
	label: string;
	onClick: () => void;
}

export function SuggestionChips({
	icon,
	items,
	label,
}: {
	icon: LucideIcon;
	items: readonly Suggestion[];
	/** 这一列的读屏名字 */
	label: string;
}): ReactNode {
	return (
		<ul aria-label={label} className="ui-suggestion-chips">
			{items.map((item, i) => (
				<li className="ui-suggestion-chips-item" key={item.key}>
					<Tooltip title={item.label}>
						<button
							className="ui-suggestion-chip"
							onClick={item.onClick}
							style={{ animationDelay: `${i * 60}ms` }}
							type="button"
						>
							<Icon
								aria-hidden="true"
								className="ui-suggestion-chip-icon"
								icon={icon}
								size={14}
							/>
							<span className="ui-suggestion-chip-label">{item.label}</span>
						</button>
					</Tooltip>
				</li>
			))}
		</ul>
	);
}
