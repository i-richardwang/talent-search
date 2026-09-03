import { ChevronDownIcon, EyeOffIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	Menu,
	MenuGroupLabel,
	MenuItem,
	MenuPopup,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuTrigger,
} from "#/components/ui/menu";
import { cn } from "#/lib/utils";
import type { Chip, ChipMode } from "#/search/parse";

/**
 * 查询条件：一个概念词一枚 chip，可改强度、可删。
 *
 * 它是**系统读出来的东西**，不是查询本身——查询是上面那句原话（见
 * `query-deck.tsx`）。所以这里只做微调：改强度、停用、删掉一枚，都比重写整句
 * 快。说不清哪儿错了的时候，出路在那句话上，不在这排 chip 上。
 *
 * 停用（`~`，见 parse.ts）保留词和强度，只让它退出本次检索，
 * 用于快速判断某个条件是否过窄。
 */

/**
 * 一枚 chip 的静息外观：强度落在 Button 的 variant 上，不另配一套底色。
 * 「必须」是实心的次要底（它是默认，也是最常见的一档），另两档是描边——
 * 描边和实心的差别足够读出「这一枚不一样」，而且不占任何一个色相
 * （全站的色相已经各有其主，见 `evidence.tsx`）。
 */
const MODE_VARIANT: Record<ChipMode, "secondary" | "outline"> = {
	must: "secondary",
	boost: "outline",
	exclude: "outline",
};

/** chip 的尺码。和 `MODE_VARIANT` 一起，构成 chip 静息态的全部外观。 */
const CHIP_SIZE = "xs" as const;

const MODE_LABEL: Record<ChipMode, string> = {
	must: "必须",
	boost: "加分",
	exclude: "排除",
};

const MODE_HINT: Record<ChipMode, string> = {
	must: "仅显示具备这项经历的人",
	boost: "具备这项经历的人优先显示",
	exclude: "这类经历不再作为证据；仅有这类经历的人不再显示",
};

/**
 * 强度写在符号上，不写在颜色上。
 *
 * 全站的色相已经各有其主：绿是受控字段命中、蓝是选中、amber 是查询上的提示。
 * 再给 chip 发三个颜色，等于让同一片绿在证据行里和查询条里说两件事。`+` 和 `-` 是
 * 搜索框里几十年的老约定，不需要教，也不占用任何一个色相。
 *
 * 「必须」不带符号：它是默认，而默认不该有标记——大多数查询整条都是必须词，
 * 一排 `=` 号只会让人以为那是要读的内容。
 */
const MODE_SIGN: Record<ChipMode, string> = {
	must: "",
	boost: "+",
	exclude: "−",
};

/**
 * 排除词划掉：排除的意思正是「把它划掉」，这一层不必再解释一遍。
 *
 * 只划掉，不降色。降色是**停用**那一档的语言（见下面的 `OFF_STYLE`），
 * 两件事借同一个记号，一枚划掉又发灰的 chip 就说不清自己是「不要这种人」
 * 还是「这条先不算」——而这两句话的意思正好相反。
 */
const EXCLUDE_STYLE = "line-through";

/**
 * 停用的样子：虚线边 + 次要色。
 *
 * 不用划掉——那是排除词的意思（「干过的人不要」），两件事撞在同一个记号上
 * 会让人以为停用一个词等于排除它，而那正好是反的。也不用透明度：`opacity`
 * 会把里面那个强度符号一起调淡，而重新启用之后它是必须还是加分，恰恰是
 * 停用期间最该看得清的一件事。虚线是「这里有个位置，但现在是空的」的通用画法。
 */
const OFF_STYLE = "border-dashed text-muted-foreground";

const MODES = ["must", "boost", "exclude"] as const;

export function QueryChips({
	chips,
	onChange,
}: {
	chips: Chip[];
	onChange: (next: Chip[]) => void;
}) {
	if (chips.length === 0) return null;

	const replace = (i: number, mode: ChipMode) =>
		onChange(chips.map((c, j) => (j === i ? { ...c, mode } : c)));
	const remove = (i: number) => onChange(chips.filter((_, j) => j !== i));
	// 停用只加/去一个字段，强度和说法始终原样保留。重新启用连 wide 一起摘：
	// 那是「我知道它宽，照跑」；显式启用后的条件按普通 chip 处理。
	const toggle = (i: number) =>
		onChange(
			chips.map((c, j) => {
				if (j !== i) return c;
				const { off: _off, wide: _wide, ...rest } = c;
				return { ...rest, ...(!c.off && { off: true as const }) };
			}),
		);
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{chips.map((chip, i) => {
				return (
					<Menu key={`${chip.off ? "~" : ""}${chip.mode}:${chip.term}`}>
						<MenuTrigger
							render={
								<Button
									className={cn(
										chip.mode === "exclude" && EXCLUDE_STYLE,
										chip.off && OFF_STYLE,
									)}
									size={CHIP_SIZE}
									variant={chip.off ? "outline" : MODE_VARIANT[chip.mode]}
								/>
							}
						>
							{MODE_SIGN[chip.mode] && (
								<span className="font-mono text-muted-foreground">
									{MODE_SIGN[chip.mode]}
								</span>
							)}
							{/* 并列说法（或）与主词同权重，平着写 */}
							<span>{[chip.term, ...(chip.alts ?? [])].join(" / ")}</span>
							{/* 「太宽」是成因，得用字说；只给一个停用图标的话，
							    自动停的和自己停的在屏幕上就分不出来了 */}
							{chip.wide && <span className="text-xs">太宽</span>}
							{chip.off && <EyeOffIcon />}
							<ChevronDownIcon />
						</MenuTrigger>
						<MenuPopup align="start">
							{chip.off && (
								<>
									<MenuGroupLabel>
										<span className="block max-w-64 whitespace-normal text-muted-foreground text-xs">
											{chip.wide
												? "这个词命中的人太多，几乎筛不掉谁，已自动停用。" +
													"换个更具体的说法效果更好；重新启用后将照常参与检索。"
												: `此条件当前未生效。重新启用后仍为「${MODE_LABEL[chip.mode]}」条件。`}
										</span>
									</MenuGroupLabel>
									<MenuSeparator />
								</>
							)}
							<MenuRadioGroup
								onValueChange={(mode) => replace(i, mode as ChipMode)}
								value={chip.mode}
							>
								{MODES.map((mode) => (
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
							{/*
							 * 停用和删除挨着放，但不是一档事，所以只有删除是危险色：
							 * 停用改的是这一次检索，删除改的是查询本身，而后者不可撤销
							 * （词没了，强度也一起没了）。
							 */}
							<MenuSeparator />
							<MenuItem onClick={() => toggle(i)}>
								{chip.off ? "重新启用" : "暂不使用"}
							</MenuItem>
							<MenuItem onClick={() => remove(i)} variant="destructive">
								删除条件
							</MenuItem>
						</MenuPopup>
					</Menu>
				);
			})}
		</div>
	);
}
