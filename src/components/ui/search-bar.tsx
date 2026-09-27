import { LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "#/lib/utils";
import { ActionIcon } from "./action-icon";
import { Hotkey, matchesHotkey } from "./hotkey";
import { Icon } from "./icon";
import { Input, type InputSize, type InputVariant } from "./input";

/*
 * 搜索框，样式在 search-bar.css。`<search>` 里一个表单：前面一个 14px 的淡色搜索图标
 * （`loading` 时换成转圈），回车就搜（`onSearch`），`allowClear`（缺省开）时有字末尾出现
 * 清空，清空同时搜一次空词。没有「搜索」按钮。框里的字受控（`value` / `onChange`），
 * 搜的是去掉首尾空白的字。`size`、`variant` 原样交给 Input。
 *
 * `shortKey` 给了就在整页上听这组键（`k` 等于 `mod+k`），按下时把焦点移进框里；
 * 框空着又没有焦点时，右端离边 6px 显示这组键。
 */

export function SearchBar({
	value,
	onChange,
	onSearch,
	placeholder,
	"aria-label": ariaLabel,
	className,
	size,
	variant,
	allowClear = true,
	loading,
	shortKey,
}: {
	value: string;
	onChange: (value: string) => void;
	onSearch: (value: string) => void;
	placeholder: string;
	"aria-label": string;
	className?: string;
	size?: InputSize;
	variant?: InputVariant;
	allowClear?: boolean;
	loading?: boolean;
	shortKey?: string;
}) {
	const root = useRef<HTMLElement>(null);
	const hotkey = shortKey
		? shortKey.includes("+")
			? shortKey
			: `mod+${shortKey}`
		: undefined;

	useEffect(() => {
		if (!hotkey) return;
		const onKey = (event: KeyboardEvent) => {
			if (!matchesHotkey(event, hotkey)) return;
			event.preventDefault();
			root.current?.querySelector("input")?.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [hotkey]);

	return (
		<search className={cn("ui-search-bar", className)} ref={root}>
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
					prefix={
						<Icon
							className="ui-search-bar-icon"
							icon={loading ? LoaderCircleIcon : SearchIcon}
							size="small"
							spin={loading}
						/>
					}
					size={size}
					suffix={
						allowClear &&
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
					variant={variant}
				/>
			</form>
			{hotkey && !value && (
				<Hotkey className="ui-search-bar-short-key" compact keys={hotkey} />
			)}
		</search>
	);
}
