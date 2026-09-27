import { SearchIcon, XIcon } from "lucide-react";
import { cn } from "#/lib/utils";
import { ActionIcon } from "./action-icon";
import { Icon } from "./icon";
import { Input } from "./input";

/*
 * 搜索框，样式在 search-bar.css。`<search>` 里一个表单：前面一个淡色的搜索图标，
 * 回车就搜（`onSearch`），有字时末尾出现清空，清空同时搜一次空词。没有「搜索」按钮。
 * 框里的字受控（`value` / `onChange`），搜的是去掉首尾空白的字。
 */

export function SearchBar({
	value,
	onChange,
	onSearch,
	placeholder,
	"aria-label": ariaLabel,
	className,
}: {
	value: string;
	onChange: (value: string) => void;
	onSearch: (value: string) => void;
	placeholder: string;
	"aria-label": string;
	className?: string;
}) {
	return (
		<search className={cn("ui-search-bar", className)}>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					onSearch(value.trim());
				}}
			>
				<Input
					aria-label={ariaLabel}
					onChange={(event) => onChange(event.target.value)}
					placeholder={placeholder}
					prefix={<Icon className="ui-search-bar-icon" icon={SearchIcon} />}
					suffix={
						value && (
							<ActionIcon
								aria-label="清空"
								icon={XIcon}
								onClick={() => {
									onChange("");
									onSearch("");
								}}
								size="small"
							/>
						)
					}
					type="search"
					value={value}
				/>
			</form>
		</search>
	);
}
