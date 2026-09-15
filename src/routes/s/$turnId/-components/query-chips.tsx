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

/**
 * 一个 chip 的静息外观：强度落在 Button 的 variant 上，不另配一套底色。
 * 「必须」是实心的次要底（它是默认，也是最常见的一档），另两档是描边——
 * 描边和实心的差别足够读出「这一个不一样」，而且不占任何一个色相
 * （全站的色相已经各有其主，见 `evidence.tsx`）。
 */
const MODE_VARIANT: Record<Mode, "secondary" | "outline"> = {
	must: "secondary",
	boost: "outline",
	exclude: "outline",
};

/** chip 的尺码。和 `MODE_VARIANT` 一起，构成 chip 静息态的全部外观。 */
const CHIP_SIZE = "xs" as const;

const MODE_LABEL: Record<Mode, string> = {
	must: "必须",
	boost: "加分",
	exclude: "排除",
};

const MODE_HINT: Record<Mode, string> = {
	must: "只留满足这项的人",
	boost: "满足这项的人排前面",
	exclude: "不作证据；仅此类经历的人会消失",
};

/**
 * 排除的条件划掉：排除的意思正是「把它划掉」，这一层不必再解释一遍。
 *
 * 只划掉，不降色。降色是**停用**那一档的语言（见下面的 `OFF_STYLE`），
 * 两件事借同一个记号，一个划掉又发灰的 chip 就说不清自己是「不要这种人」
 * 还是「这条先不算」——而这两句话的意思正好相反。
 */
const EXCLUDE_STYLE = "line-through";

/**
 * 停用的样子：虚线边 + 次要色。
 *
 * 不用划掉——那是排除的意思（「干过的人不要」），两件事撞在同一个记号上
 * 会让人以为停用一个词等于排除它，而那正好是反的。也不用透明度：`opacity`
 * 会把里面那个强度符号一起调淡，而重新启用之后它是必须还是加分，恰恰是
 * 停用期间最该看得清的一件事。虚线是「这里有个位置，但现在是空的」的通用画法。
 */
const OFF_STYLE = "border-dashed text-muted-foreground";

/** chip 上「这里还有别的取值」的记号。≈ 是「差不多」最省字的写法，证据行上也用它。 */
const MORE_GLYPH = "≈";

/**
 * 系统把那句话解析成的条件，一条一个 chip。
 *
 * chip 上只显示代表取值（「增长 ≈」），其余取值和每一项的去留都收在菜单里：这排
 * chip 位于一条定高的横条上（`query-deck.tsx`），把一条条件的取值全部展开会把横条
 * 撑宽，而用户扫这一排只需要判断一件事——解析得对不对。
 *
 * 一个 chip 上可以改三件事：强度、启停、逐项去掉。三者都不在这里执行——每次改动
 * 只是用 `condition.ts` 的变换算出一份新条件交给外层，由工作台派生成一条新的查询
 * 记录。所以这个组件没有自身状态，改错了按后退即可回退。
 */
export function QueryChips({
	conditions,
	onChange,
}: {
	/** 这条查询的条件，一条一个 chip。 */
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
	// 不套自己的盒子：这几枚 chip 是查询带那一行里的元素，横着排还是换行由
	// 摆它们的地方说了算（`query-deck.tsx`——那条带在 lg 以上是定高的一行）。
	// 自己再包一层 flex，那一层的换行就会在带子里长出第二行来。
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
							{/* 「太宽」是成因，得用字说；只给一个停用图标的话，
							    自动停的和自己停的在屏幕上就分不出来了 */}
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
										{/* 两行一格：标题说这一档叫什么，副行说它会做什么。
										    改强度是这个菜单唯一的主任务，值得占两行。 */}
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
										{/* 经历主张的各项说的是同一段经历；同一项里的几个取值任一即可。
										    标题只说前一件事，后一件事由 chip 上的 ≈ 说。 */}
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
												{/* 一行两段：这一项，和点了会怎样。去掉是这一行唯一的动作，
												    所以整行可点，末尾说明白。 */}
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
							{/*
							 * 那枚开关和删除挨着放，但不是一档事，所以只有删除是危险色：
							 * 关掉改的是这一次检索，删除改的是查询本身，而后者不可撤销
							 * （条件没了，强度也一起没了）。
							 */}
							<MenuSeparator />
							{/*
							 * 启用是**状态**，不是命令，所以它是一个开关而不是一行字：
							 * 一行在「暂不使用」和「重新启用」之间换文案的字，得读完才
							 * 知道这条条件此刻算不算数，而开关把那一态常驻在屏幕上，
							 * 文案因此固定成一个词。
							 *
							 * 点它不关菜单（`MenuCheckboxItem` 自己的规矩）：拨过去看着
							 * 拇指走完，就是这一下的回执——chip 本身此刻被菜单盖着。
							 */}
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
