import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "./icon";
import { Tooltip } from "./tooltip";

/* 挂在一条回复下面的一列可点建议，出现时逐枚浮上来。一行放不下时省略，悬停提示整句。 */

interface Suggestion {
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
	/** 读屏名字。 */
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
