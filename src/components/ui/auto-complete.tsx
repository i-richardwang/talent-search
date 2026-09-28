"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { type ComponentProps, type ReactNode, useRef } from "react";
import { defaultPortalContainer } from "#/components/ui/floating";
import { type InputVariant, inputVariants } from "#/components/ui/input";
import { cn } from "#/lib/utils";

/*
 * 输入框，敲字时弹出建议，选中一项就把它的 `value` 填进框里。`onChange` 的第二个参数是
 * Base UI 的 eventDetails：选中一项时 `reason` 是 `item-press`，敲字时是 `input-change`，
 * 要把选中当成动作而不是填字时靠它分辨。
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
	onChange: (
		value: string,
		details: Autocomplete.Root.ChangeEventDetails,
	) => void;
	options: AutoCompleteOption[];
	placeholder: string;
	suffix?: ReactNode;
	"aria-label"?: string;
	className?: string;
	variant?: InputVariant;
}

export function AutoComplete({
	options,
	onChange,
	placeholder,
	suffix,
	"aria-label": ariaLabel,
	className,
	variant,
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
			<div
				className={cn(inputVariants({ variant }), className)}
				ref={anchorRef}
			>
				<Autocomplete.Input
					aria-label={ariaLabel}
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
