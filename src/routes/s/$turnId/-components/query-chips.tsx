import { CheckIcon, ChevronDownIcon, EyeOffIcon } from "lucide-react";
import {
	type DropdownItem,
	DropdownMenuHeader,
	DropdownMenuItemContent,
	DropdownMenuItemDesc,
	DropdownMenuItemIcon,
	DropdownMenuItemLabel,
	DropdownMenuItemLabelGroup,
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItemIndicator,
	DropdownMenuRadioItemPrimitive,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import {
	FilterChip,
	FilterChipClear,
	FilterChipNote,
	FilterChipTrigger,
	FilterChipValue,
} from "#/components/ui/filter-chip";
import { Icon } from "#/components/ui/icon";
import { MODES, type Mode, PERSON_MODES } from "#/search/condition";
import { MODE_NAME } from "#/search/condition-label";
import { type QueryCondition, withOff } from "#/search/query";

const MODE_HINT: Record<Mode, string> = {
	must: "只保留满足此条件的人",
	boost: "满足此条件的人排在前面",
	exclude: "不保留有这类经历的人",
};

/** 换强度。换成排除时累计时长不再有意义（有一段就排除），去掉。 */
function withMode(c: QueryCondition, mode: Mode): QueryCondition {
	const { minMonths, ...rest } = c;
	return mode === "exclude" ? { ...rest, mode } : { ...c, mode };
}

/**
 * 一排条件，一条一枚 `FilterChip`，点开是这一条的菜单。chip 上是 AI 写给 HR 的那句标签；
 * 强度写成字：必须是默认，不标；加分、排除和写进句子里（`labelsInSentence`）的是同一个说法。
 * 在这里改的条件立刻生效，名单先按已经确认过的人出。
 */
export function QueryChips({
	conditions,
	onChange,
}: {
	conditions: readonly QueryCondition[];
	onChange: (next: QueryCondition[]) => void;
}) {
	if (conditions.length === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{conditions.map((chip, index) => {
				const { label } = chip;
				const modes = chip.from === "person" ? PERSON_MODES : MODES;
				const update = (next: QueryCondition) =>
					onChange(conditions.with(index, next));
				const actions: DropdownItem[] = [
					{ type: "divider" },
					{
						checked: !chip.off,
						key: "on",
						label: "启用",
						onCheckedChange: (on) => update(withOff(chip, on ? null : "user")),
						type: "switch",
					},
				];
				return (
					<FilterChip dashed={Boolean(chip.off)} key={chip.id}>
						<DropdownMenuRoot>
							<DropdownMenuTrigger>
								<FilterChipTrigger
									aria-label={[
										MODE_NAME[chip.mode],
										label,
										chip.off && "已停用",
									]
										.filter(Boolean)
										.join("，")}
								>
									{chip.off && <Icon icon={EyeOffIcon} size={12} />}
									<FilterChipValue>{label}</FilterChipValue>
									{chip.mode !== "must" && (
										<FilterChipNote>{MODE_NAME[chip.mode]}</FilterChipNote>
									)}
									<Icon icon={ChevronDownIcon} size={10} />
								</FilterChipTrigger>
							</DropdownMenuTrigger>
							<DropdownMenuPortal>
								<DropdownMenuPositioner>
									<DropdownMenuPopup>
										{chip.off && (
											<DropdownMenuHeader className="max-w-64 text-fg-secondary text-xs">
												{`已停用，重新启用后仍为「${MODE_NAME[chip.mode]}」。`}
											</DropdownMenuHeader>
										)}
										<DropdownMenuRadioGroup
											onValueChange={(mode: Mode) =>
												update(withMode(chip, mode))
											}
											value={chip.mode}
										>
											{modes.map((mode) => (
												<DropdownMenuRadioItemPrimitive
													key={mode}
													label={MODE_NAME[mode]}
													value={mode}
												>
													<DropdownMenuItemContent>
														<DropdownMenuItemIcon>
															<DropdownMenuRadioItemIndicator>
																<Icon icon={CheckIcon} />
															</DropdownMenuRadioItemIndicator>
														</DropdownMenuItemIcon>
														<DropdownMenuItemLabelGroup>
															<DropdownMenuItemLabel>
																{MODE_NAME[mode]}
															</DropdownMenuItemLabel>
															<DropdownMenuItemDesc>
																{MODE_HINT[mode]}
															</DropdownMenuItemDesc>
														</DropdownMenuItemLabelGroup>
													</DropdownMenuItemContent>
												</DropdownMenuRadioItemPrimitive>
											))}
										</DropdownMenuRadioGroup>
										{renderDropdownMenuItems(actions, {
											reserveIconSpace: true,
										})}
									</DropdownMenuPopup>
								</DropdownMenuPositioner>
							</DropdownMenuPortal>
						</DropdownMenuRoot>
						{conditions.length > 1 && (
							<FilterChipClear
								label={`删除条件「${label}」`}
								onClear={() => onChange(conditions.toSpliced(index, 1))}
							/>
						)}
					</FilterChip>
				);
			})}
		</div>
	);
}
