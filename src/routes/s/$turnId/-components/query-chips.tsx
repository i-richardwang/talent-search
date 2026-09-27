import { CheckIcon, ChevronDownIcon, EyeOffIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
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
import { Icon } from "#/components/ui/icon";
import { Text } from "#/components/ui/text";
import {
	type Condition,
	conditionKey,
	type Mode,
	modesOf,
	partsOf,
	withMode,
	withOff,
	withoutPart,
} from "#/search/condition";
import {
	conditionLabel,
	MODE_NAME,
	moreCount,
	partLabel,
} from "#/search/condition-label";

const MODE_HINT: Record<Mode, string> = {
	must: "只保留满足此条件的人",
	boost: "满足此条件的人排在前面",
	exclude: "排除有这类经历的人",
};

/**
 * 一排条件，一条一个 chip。强度写成字：必须是默认，不标；加分、排除在条件后面跟一个
 * 三级灰的词，和「（加分）」写进句子里（`inSentence`）是同一个说法。
 * 必须铺底（fill），加分、排除描边（default）；停用的换成虚线边（dashed），
 * 字退到次要色。
 */
export function QueryChips({
	conditions,
	onChange,
}: {
	conditions: readonly Condition[];
	onChange: (next: Condition[]) => void;
}) {
	if (conditions.length === 0) return null;

	const replaceAt = (i: number, next: Condition | null) =>
		onChange(
			next === null
				? conditions.filter((_, j) => j !== i)
				: conditions.map((c, j) => (j === i ? next : c)),
		);
	return (
		<>
			{conditions.map((chip, i) => {
				const label = conditionLabel(chip);
				const more = moreCount(chip);
				const parts = partsOf(chip);
				const wide = chip.off === "wide";
				const actions: DropdownItem[] = [
					...(parts.length > 1
						? [
								{ type: "divider" as const },
								{
									children: parts.map((part) => ({
										key: `${part.key}\u0001${part.value}`,
										label: `去掉「${partLabel(chip, part)}」`,
										onClick: () => replaceAt(i, withoutPart(chip, part)),
									})),
									label:
										chip.about === "experience" ? "同一段经历" : "任一满足即可",
									type: "group" as const,
								},
							]
						: []),
					{ type: "divider" },
					{
						checked: !chip.off,
						key: "on",
						label: "启用",
						onCheckedChange: (on) =>
							replaceAt(i, withOff(chip, on ? null : "user")),
						type: "switch",
					},
					{
						danger: true,
						key: "delete",
						label: "删除条件",
						onClick: () => replaceAt(i, null),
					},
				];
				return (
					<DropdownMenuRoot key={conditionKey(chip)}>
						<DropdownMenuTrigger>
							<Button
								aria-label={[
									MODE_NAME[chip.mode],
									label,
									more && "等",
									wide ? "太宽，已停用" : chip.off && "已停用",
								]
									.filter(Boolean)
									.join("，")}
								className={chip.off ? "text-fg-secondary" : undefined}
								size="small"
								type={
									chip.off
										? "dashed"
										: chip.mode === "must"
											? "fill"
											: "default"
								}
							>
								<span>{label}</span>
								{more > 0 && <Text type="secondary">+{more}</Text>}
								{chip.mode !== "must" && (
									<Text type="tertiary">{MODE_NAME[chip.mode]}</Text>
								)}
								{wide && <span>太宽</span>}
								{chip.off && <Icon icon={EyeOffIcon} size="small" />}
								<Icon icon={ChevronDownIcon} size="small" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuPortal>
							<DropdownMenuPositioner>
								<DropdownMenuPopup>
									{chip.off && (
										<DropdownMenuHeader className="max-w-64 text-fg-secondary text-xs">
											{wide
												? "范围过大，几乎所有人都满足，已停用。请换一个更具体的词。"
												: `已停用，重新启用后仍为「${MODE_NAME[chip.mode]}」。`}
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
									{renderDropdownMenuItems(actions, { reserveIconSpace: true })}
								</DropdownMenuPopup>
							</DropdownMenuPositioner>
						</DropdownMenuPortal>
					</DropdownMenuRoot>
				);
			})}
		</>
	);
}
