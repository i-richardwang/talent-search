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
	FilterChipCount,
	FilterChipNote,
	FilterChipTrigger,
	FilterChipValue,
} from "#/components/ui/filter-chip";
import { Icon } from "#/components/ui/icon";
import type { Mode } from "#/search/condition";
import { MODE_NAME } from "#/search/condition-label";
import { type QueryCondition, withOff } from "#/search/query";

const MODE_HINT: Record<Mode, string> = {
	must: "只保留满足此条件的人",
	boost: "满足此条件的人排在前面",
	exclude: "这类经历不作为匹配依据",
};

/** 一条条件能换成的强度：排除只用于经历。 */
function modesOf(c: QueryCondition): readonly Mode[] {
	return c.from === "experience"
		? ["must", "boost", "exclude"]
		: ["must", "boost"];
}

/** 换强度。换成排除时累计时长不再有意义（排除按单段判），去掉。 */
function withMode(c: QueryCondition, mode: Mode): QueryCondition {
	const { minMonths, ...rest } = c;
	return mode === "exclude" ? { ...rest, mode } : { ...c, mode };
}

/**
 * 一排条件，一条一枚 `FilterChip`，点开是这一条的菜单。chip 上是 AI 写给 HR 的那句标签；
 * 强度写成字：必须是默认，不标；加分、排除和写进句子里（`labelsInSentence`）的是同一个说法。
 * 最右边是这一条单独能找到的人数（排除是它否决了多少人的经历），和线程里试搜的是同一个数；
 * 停用的没有人数。
 */
export function QueryChips({
	conditions,
	counts,
	onChange,
}: {
	conditions: readonly QueryCondition[];
	/** 每条条件单独的人数，按 id；没有的不画 */
	counts: Readonly<Record<string, number>>;
	onChange: (next: QueryCondition[]) => void;
}) {
	if (conditions.length === 0) return null;

	const replaceAt = (i: number, next: QueryCondition | null) =>
		onChange(
			next === null
				? conditions.filter((_, j) => j !== i)
				: conditions.map((c, j) => (j === i ? next : c)),
		);
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{conditions.map((chip, i) => {
				const { label } = chip;
				const people = chip.off ? undefined : counts[chip.id];
				const actions: DropdownItem[] = [
					{ type: "divider" },
					{
						checked: !chip.off,
						key: "on",
						label: "启用",
						onCheckedChange: (on) =>
							replaceAt(i, withOff(chip, on ? null : "user")),
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
										people !== undefined && `${people} 人`,
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
									{people !== undefined && (
										<FilterChipCount>{people} 人</FilterChipCount>
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
											onValueChange={(mode) =>
												replaceAt(i, withMode(chip, mode as Mode))
											}
											value={chip.mode}
										>
											{modesOf(chip).map((mode) => (
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
						<FilterChipClear
							label={`删除条件「${label}」`}
							onClear={() => replaceAt(i, null)}
						/>
					</FilterChip>
				);
			})}
		</div>
	);
}
