"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { type ComponentProps, type ReactNode, useRef } from "react";
import { defaultPortalContainer } from "#/components/ui/floating";
import { inputVariants } from "#/components/ui/input";

/*
 * 样式在 auto-complete.css，与菜单共用的块在 dropdown-menu.css，输入框外壳用 input.css
 * 的中号、默认外观。一个输入框，敲字时弹出建议；`value` 是框里的字，选中一项就把它的
 * `value` 填进框里。`filter`、`open` 等 Root 的属性原样传下去。
 *
 * - `onChange` 的第二个参数是 Base UI 的 eventDetails。选中一项（点、触屏轻点、
 *   回车选高亮项）时 `reason` 是 `item-press`，敲字时是 `input-change`；要把选中的一项
 *   当成动作而不是填进框里的字时，靠它分辨。
 * - 外壳的深浅两种默认由 CSS 按 `.dark` 选（input.css 的 `ui-input-auto`），
 *   不在渲染时读主题。
 * - portal 到 `<body>`（`defaultPortalContainer`，在别的浮层里打开时也不嵌进它的
 *   portal）；定位器的 z 值是 `--z-index-popup` 这一档，不按打开先后另分配，
 *   碰撞边距用 Base UI 的默认值（见 floating.ts）。
 */

interface AutoCompleteOption {
	label: ReactNode;
	value: string;
}

type RootProps = ComponentProps<typeof Autocomplete.Root>;

interface AutoCompleteProps
	extends Pick<
		RootProps,
		"filter" | "onItemHighlighted" | "onOpenChange" | "open" | "value"
	> {
	/** 框里的字变了：敲字，或选中了一项（`details.reason` 分辨）。 */
	onChange: (
		value: string,
		details: Autocomplete.Root.ChangeEventDetails,
	) => void;
	options: AutoCompleteOption[];
	placeholder: string;
	suffix?: ReactNode;
}

export function AutoComplete({
	options,
	onChange,
	placeholder,
	suffix,
	...rest
}: AutoCompleteProps) {
	const anchorRef = useRef<HTMLDivElement>(null);

	return (
		<Autocomplete.Root
			itemToStringValue={(item) => (item as AutoCompleteOption).value}
			items={options}
			onValueChange={onChange}
			openOnInputClick
			{...rest}
		>
			<div className={inputVariants({})} ref={anchorRef}>
				<Autocomplete.Input
					className="ui-input-input"
					placeholder={placeholder}
				/>
				{suffix && <span className="ui-input-slot">{suffix}</span>}
			</div>
			<Autocomplete.Portal container={defaultPortalContainer()}>
				<Autocomplete.Positioner
					anchor={anchorRef}
					className="ui-dropdown-menu-positioner"
					sideOffset={4}
				>
					<Autocomplete.Popup className="ui-dropdown-menu-popup ui-auto-complete-popup">
						<Autocomplete.List className="ui-auto-complete-list">
							{(item: AutoCompleteOption) => (
								<Autocomplete.Item
									className="ui-dropdown-menu-item"
									key={item.value}
									value={item}
								>
									{item.label}
								</Autocomplete.Item>
							)}
						</Autocomplete.List>
					</Autocomplete.Popup>
				</Autocomplete.Positioner>
			</Autocomplete.Portal>
		</Autocomplete.Root>
	);
}
