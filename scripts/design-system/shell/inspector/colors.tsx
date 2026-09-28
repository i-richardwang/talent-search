import { ChevronDown, X } from "lucide-react";
import { useId, useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Empty } from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import { Popover } from "#/components/ui/popover";
import { Radio, RadioGroup } from "#/components/ui/radio";
import { cn } from "#/lib/utils";
import { parseColor, toHex } from "../../shared/color";
import { ModifiedMark, Swatch } from "../../shared/marks";
import { originalValue, tokenValue, updateToken } from "../../shared/source";
import {
	COLOR_TOKENS,
	SCOPE_LABEL,
	type Theme,
	tokenLabel,
} from "../../shared/tokens/registry";
import { ColorEditor } from "../color-editor";
import type { Editing } from "./editing";

/** 一个颜色的编辑器，改的是 `theme` 那一侧。 */
function ThemeColorEditor({
	editing: { draft, onEdit, onPreview, previewDraft },
	theme,
	token,
}: {
	editing: Editing;
	theme: Theme;
	token: string;
}) {
	const value = tokenValue(previewDraft, theme, token);
	return (
		<ColorEditor
			onCommit={(next) => onEdit(updateToken(draft, theme, token, next))}
			onPreview={(next) =>
				onPreview(
					next === null ? null : { key: token, scope: theme, value: next },
				)
			}
			original={originalValue(theme, token) ?? value}
			token={token}
			value={value}
		/>
	);
}

/** 一行颜色：点开是这个颜色的编辑器，同时选中这个颜色。 */
function ColorRow({
	editing,
	onSelectColor,
	theme,
	token,
}: {
	editing: Editing;
	onSelectColor: (token: string) => void;
	theme: Theme;
	token: string;
}) {
	const [open, setOpen] = useState(false);
	const value = tokenValue(editing.previewDraft, theme, token);
	const color = parseColor(value);
	const label = tokenLabel(token);
	return (
		<Popover
			content={
				<div className="flex w-60 flex-col gap-3">
					<div className="flex items-center gap-2 text-xs">
						<strong className="font-semibold">{label}</strong>
						<span className="text-fg-tertiary">{SCOPE_LABEL[theme]}</span>
						<ActionIcon
							className="ml-auto"
							icon={X}
							onClick={() => {
								setOpen(false);
								editing.onPreview(null);
							}}
							size="small"
							title="关闭"
						/>
					</div>
					<ThemeColorEditor editing={editing} theme={theme} token={token} />
				</div>
			}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) onSelectColor(token);
				else editing.onPreview(null);
			}}
			open={open}
			placement="left"
			trigger="click"
		>
			<button
				aria-label={`编辑${label}`}
				className={cn(
					"flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-fill-tertiary",
					open && "bg-fill-secondary",
				)}
				title={token}
				type="button"
			>
				<span className="min-w-0 flex-1 truncate text-fg-secondary">
					{label}
				</span>
				<Swatch className="size-4" color={value} />
				<code className="w-24 text-fg-tertiary">
					{color ? toHex(color).slice(1) : value}
					{color && color.a < 1 && ` · ${Math.round(color.a * 100)}%`}
				</code>
				{token in editing.draft[theme] ? (
					<ModifiedMark />
				) : (
					<span className="size-1.5" />
				)}
			</button>
		</Popover>
	);
}

/** 右栏「颜色」一节：本页的颜色排在前面，其余收在「更多颜色」里。 */
export function PageColors({
	colors,
	editing,
	onSelectColor,
	theme,
}: {
	colors: readonly string[];
	editing: Editing;
	onSelectColor: (token: string) => void;
	theme: Theme;
}) {
	const [more, setMore] = useState(false);
	const panelId = useId();
	const rest = COLOR_TOKENS.filter(([key]) => !colors.includes(key));
	const row = (token: string) => (
		<ColorRow
			editing={editing}
			key={token}
			onSelectColor={onSelectColor}
			theme={theme}
			token={token}
		/>
	);
	return (
		<div className="flex flex-col gap-1">
			{colors.map(row)}
			<CollapsibleTrigger
				className="mt-1 px-1.5 py-1 text-fg-tertiary"
				onOpenChange={setMore}
				open={more}
				panelId={panelId}
			>
				更多颜色
			</CollapsibleTrigger>
			<Collapsible id={panelId} open={more}>
				<div className="flex flex-col gap-1">
					{rest.map(([key]) => row(key))}
				</div>
			</Collapsible>
		</div>
	);
}

/** 颜色页的右栏：选中的那个颜色的编辑器；上面的选择框可以换成别的颜色。 */
export function SelectedColor({
	editing,
	onSelectColor,
	selectedColor,
	theme,
}: {
	editing: Editing;
	onSelectColor: (token: string) => void;
	selectedColor: string;
	theme: Theme;
}) {
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const needle = query.trim().toLowerCase();
	const matches = COLOR_TOKENS.filter(([key, label]) =>
		`${key} ${label}`.toLowerCase().includes(needle),
	);
	return (
		<section className="flex flex-col gap-3 p-4 text-xs">
			<span className="text-fg-tertiary">{SCOPE_LABEL[theme]}</span>
			<Popover
				content={
					<div className="flex w-80 flex-col gap-2">
						<Input
							aria-label="搜索颜色"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="搜索名称或令牌名…"
							size="small"
							value={query}
						/>
						{matches.length === 0 ? (
							<Empty
								description="换个名称或令牌名试试。"
								title="没有匹配的颜色"
							/>
						) : (
							<RadioGroup
								aria-label="颜色"
								className="flex max-h-72 flex-col gap-2 overflow-y-auto px-1 py-1"
								onChange={(key) => {
									onSelectColor(key);
									setOpen(false);
									setQuery("");
								}}
								value={selectedColor}
							>
								{matches.map(([key, label]) => (
									<Radio key={key} value={key}>
										<span className="flex items-center gap-2 whitespace-nowrap">
											<Swatch
												className="size-4"
												color={tokenValue(editing.draft, theme, key)}
											/>
											<span>{label}</span>
											<code className="text-fg-tertiary">{key}</code>
										</span>
									</Radio>
								))}
							</RadioGroup>
						)}
					</div>
				}
				nativeButton
				onOpenChange={setOpen}
				open={open}
				placement="bottomRight"
				trigger="click"
			>
				<Block
					align="center"
					aria-label={`换一个颜色，现在是${tokenLabel(selectedColor)}`}
					as="button"
					clickable
					gap={10}
					horizontal
					paddingBlock={10}
					paddingInline={12}
					variant="outlined"
				>
					<Swatch
						className="size-7 rounded-sm"
						color={tokenValue(editing.previewDraft, theme, selectedColor)}
					/>
					<span className="flex min-w-0 flex-1 flex-col text-left">
						<strong className="font-semibold text-sm">
							{tokenLabel(selectedColor)}
						</strong>
						<code className="truncate text-fg-tertiary">{selectedColor}</code>
					</span>
					<ChevronDown className="size-3.5 text-fg-tertiary" />
				</Block>
			</Popover>
			<ThemeColorEditor
				editing={editing}
				key={`${theme}:${selectedColor}`}
				theme={theme}
				token={selectedColor}
			/>
		</section>
	);
}
