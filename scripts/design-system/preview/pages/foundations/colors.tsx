import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Empty } from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import { Tabs } from "#/components/ui/tabs";
import { parseColor, toHex } from "../../../shared/color";
import { ModifiedMark, Swatch } from "../../../shared/marks";
import { sendToShell } from "../../../shared/protocol";
import { tokenValue } from "../../../shared/source";
import { COLOR_GROUPS } from "../../../shared/tokens/registry";
import { useCurrentPage, usePreviewState } from "../../state";
import { ColorUsage } from "./color-usage";

/** 在外壳里选中一个颜色，右栏换成它的编辑器。 */
export const selectColor = (token: string) =>
	sendToShell({ token, type: "design-system:select-color" });

/** 颜色页：色板，以及用途与对比度。 */
export function ColorsPage() {
	const { draft, selectedColor, theme } = usePreviewState();
	const { title } = useCurrentPage();
	const [query, setQuery] = useState("");
	const [section, setSection] = useState("palette");
	const needle = query.trim().toLowerCase();
	const groups = COLOR_GROUPS.map((group) => ({
		...group,
		tokens: group.tokens.filter(([key, label]) =>
			`${key} ${label}`.toLowerCase().includes(needle),
		),
	})).filter((group) => group.tokens.length > 0);
	const count = groups.reduce((sum, group) => sum + group.tokens.length, 0);
	return (
		<div className="mx-auto max-w-6xl p-9 max-md:p-6">
			<header className="mb-9 flex flex-wrap items-center justify-between gap-5">
				<div className="flex items-baseline gap-3">
					<h1 className="font-semibold text-xl">{title}</h1>
					<span className="text-fg-tertiary text-xs">{count} 个令牌</span>
				</div>
				{section === "palette" && (
					<Input
						aria-label="搜索颜色"
						className="w-64 max-w-full"
						onChange={(event) => setQuery(event.target.value)}
						placeholder="搜索名称或令牌名…"
						type="search"
						value={query}
					/>
				)}
			</header>
			<Tabs
				activeKey={section}
				items={[
					{
						children: (
							<div className="pt-4">
								{groups.map((group) => (
									<section
										aria-labelledby={`palette-${group.id}`}
										className="mb-8"
										key={group.id}
									>
										<h2
											className="mb-3.5 font-semibold text-base"
											id={`palette-${group.id}`}
										>
											{group.title}
										</h2>
										<div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
											{group.tokens.map(([key, label]) => {
												const value = tokenValue(draft, theme, key);
												const color = parseColor(value);
												return (
													<Block
														aria-label={`编辑${label}`}
														aria-pressed={selectedColor === key}
														as="button"
														className="min-w-0 text-left"
														clickable
														gap={4}
														key={key}
														onClick={() => selectColor(key)}
														padding={8}
														selected={selectedColor === key}
														variant="outlined"
													>
														<Swatch
															className="mb-1 h-20 w-full rounded-sm"
															color={value}
														/>
														<span className="flex items-center gap-1.5 px-1 font-medium text-xs">
															{label}
															{key in draft[theme] && <ModifiedMark />}
														</span>
														<code className="break-all px-1 text-fg-tertiary text-xs">
															{key}
														</code>
														<span className="px-1 pb-1 text-xs tabular-nums">
															{color ? toHex(color) : value}
															{color &&
																color.a < 1 &&
																` · ${Number((color.a * 100).toFixed(1))}%`}
														</span>
													</Block>
												);
											})}
										</div>
									</section>
								))}
								{groups.length === 0 && (
									<Empty
										description="换个名称或令牌名试试。"
										title="没有匹配的颜色"
									/>
								)}
							</div>
						),
						key: "palette",
						label: "色板",
					},
					{
						children: <ColorUsage />,
						key: "usage",
						label: "用途与对比度",
					},
				]}
				onChange={setSection}
			/>
		</div>
	);
}
