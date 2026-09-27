import { Menu } from "@base-ui/react/menu";
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import {
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRadioGroup,
	DropdownMenuRoot,
	DropdownMenuTrigger,
} from "./dropdown-menu";
import { Icon } from "./icon";

/*
 * 几选一的菜单，样式在 choice-menu.css。每一项是一张小卡：左边 32px 描边方块里的图标，
 * 右边名字和一句说明；选中的那一项铺底，不另画勾。用在「选一种做法」这类每一项都要
 * 解释一句的地方，只有名字的单选用下拉菜单的单选项。
 *
 * 键盘、单选语义和弹层的定位、动效都是下拉菜单的（Base UI 的 `Menu.RadioGroup`）。
 */

export interface ChoiceMenuOption<T extends string> {
	value: T;
	label: string;
	desc: string;
	icon: LucideIcon;
}

export function ChoiceMenu<T extends string>({
	value,
	onValueChange,
	options,
	children,
}: {
	value: T;
	onValueChange: (value: T) => void;
	options: readonly ChoiceMenuOption<T>[];
	/** 触发器，单个按钮。 */
	children: ReactElement;
}) {
	return (
		<DropdownMenuRoot>
			<DropdownMenuTrigger>{children}</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuPositioner>
					<DropdownMenuPopup className="ui-choice-menu">
						<DropdownMenuRadioGroup
							className="ui-choice-menu-group"
							onValueChange={(next) => onValueChange(next as T)}
							value={value}
						>
							{options.map((option) => (
								<Menu.RadioItem
									className="ui-choice-menu-option"
									key={option.value}
									label={option.label}
									value={option.value}
								>
									<span className="ui-choice-menu-icon">
										<Icon icon={option.icon} size={16} />
									</span>
									<span className="ui-choice-menu-text">
										<span className="ui-choice-menu-label">{option.label}</span>
										<span className="ui-choice-menu-desc">{option.desc}</span>
									</span>
								</Menu.RadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuPopup>
				</DropdownMenuPositioner>
			</DropdownMenuPortal>
		</DropdownMenuRoot>
	);
}
