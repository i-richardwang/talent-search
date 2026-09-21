import { ChevronDownIcon, EyeOffIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	Menu,
	MenuCheckboxItem,
	MenuGroup,
	MenuGroupLabel,
	MenuItem,
	MenuPopup,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuTrigger,
} from "#/components/ui/menu";
import { cn } from "#/lib/utils";
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
	hasMore,
	MODE_GLYPH,
	partLabel,
} from "#/search/condition-label";

const MODE_VARIANT: Record<Mode, "secondary" | "outline"> = {
	must: "secondary",
	boost: "outline",
	exclude: "outline",
};

const CHIP_SIZE = "xs" as const;

const MODE_LABEL: Record<Mode, string> = {
	must: "必须",
	boost: "加分",
	exclude: "排除",
};

const MODE_HINT: Record<Mode, string> = {
	must: "只留满足这项的人",
	boost: "满足这项的人排前面",
	exclude: "排除有这类经历的人",
};

const EXCLUDE_STYLE = "line-through";

const OFF_STYLE = "border-dashed text-muted-foreground";

const MORE_GLYPH = "≈";

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
				const more = hasMore(chip);
				const parts = partsOf(chip);
				const wide = chip.off === "wide";
				return (
					<Menu key={conditionKey(chip)}>
						<MenuTrigger
							render={
								<Button
									aria-label={[
										MODE_LABEL[chip.mode],
										label,
										more && "等",
										wide ? "太宽，已停用" : chip.off && "已停用",
									]
										.filter(Boolean)
										.join("，")}
									className={cn(
										chip.mode === "exclude" && EXCLUDE_STYLE,
										chip.off && OFF_STYLE,
									)}
									size={CHIP_SIZE}
									variant={chip.off ? "outline" : MODE_VARIANT[chip.mode]}
								/>
							}
						>
							{MODE_GLYPH[chip.mode] && (
								<span className="font-mono text-muted-foreground">
									{MODE_GLYPH[chip.mode]}
								</span>
							)}
							<span>{label}</span>
							{more && (
								<span className="font-mono text-muted-foreground">
									{MORE_GLYPH}
								</span>
							)}
							{wide && <span>太宽</span>}
							{chip.off && <EyeOffIcon />}
							<ChevronDownIcon />
						</MenuTrigger>
						<MenuPopup align="start">
							{chip.off && (
								<>
									<MenuGroup>
										<MenuGroupLabel>
											<span className="block max-w-64 whitespace-normal text-muted-foreground text-xs">
												{wide
													? "几乎筛不掉人，已停用。换个更具体的词。"
													: `已停用，打开后仍是「${MODE_LABEL[chip.mode]}」。`}
											</span>
										</MenuGroupLabel>
									</MenuGroup>
									<MenuSeparator />
								</>
							)}
							<MenuRadioGroup
								onValueChange={(mode) =>
									replaceAt(i, withMode(chip, mode as Mode))
								}
								value={chip.mode}
							>
								{modesOf(chip).map((mode) => (
									<MenuRadioItem key={mode} value={mode}>
										<span className="flex flex-col py-0.5">
											<span className="text-sm">{MODE_LABEL[mode]}</span>
											<span className="text-muted-foreground text-xs">
												{MODE_HINT[mode]}
											</span>
										</span>
									</MenuRadioItem>
								))}
							</MenuRadioGroup>
							{parts.length > 1 && (
								<>
									<MenuSeparator />
									<MenuGroup>
										<MenuGroupLabel>
											{chip.about === "experience"
												? "同一段经历"
												: "任一满足即可"}
										</MenuGroupLabel>
										{parts.map((part) => (
											<MenuItem
												key={`${part.key}\u0001${part.value}`}
												onClick={() => replaceAt(i, withoutPart(chip, part))}
											>
												<span className="flex flex-1 items-baseline gap-2">
													<span>{partLabel(chip, part)}</span>
													<span className="ml-auto text-muted-foreground text-xs">
														去掉
													</span>
												</span>
											</MenuItem>
										))}
									</MenuGroup>
								</>
							)}
							<MenuSeparator />
							<MenuCheckboxItem
								checked={!chip.off}
								onCheckedChange={(on) =>
									replaceAt(i, withOff(chip, on ? null : "user"))
								}
								variant="switch"
							>
								启用
							</MenuCheckboxItem>
							<MenuItem
								onClick={() => replaceAt(i, null)}
								variant="destructive"
							>
								删除条件
							</MenuItem>
						</MenuPopup>
					</Menu>
				);
			})}
		</>
	);
}
