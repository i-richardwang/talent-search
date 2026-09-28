import { LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "#/lib/utils";
import { ActionIcon } from "./action-icon";
import { Hotkey, matchesHotkey } from "./hotkey";
import { Icon } from "./icon";
import { Input } from "./input";

/*
 * 回车就搜，没有「搜索」按钮；清空同时搜一次空词。整页上按 mod+k 把焦点移进框里：
 * 一页只放一个 SearchBar。
 */

const HOTKEY = "mod+k";

export function SearchBar({
	value,
	onChange,
	onSearch,
	placeholder,
	"aria-label": ariaLabel,
	className,
	loading,
}: {
	value: string;
	onChange: (value: string) => void;
	onSearch: (value: string) => void;
	placeholder: string;
	"aria-label": string;
	className?: string;
	loading?: boolean;
}) {
	const root = useRef<HTMLElement>(null);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!matchesHotkey(event, HOTKEY)) return;
			event.preventDefault();
			root.current?.querySelector("input")?.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

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
			{!value && (
				<Hotkey className="ui-search-bar-short-key" compact keys={HOTKEY} />
			)}
		</search>
	);
}
