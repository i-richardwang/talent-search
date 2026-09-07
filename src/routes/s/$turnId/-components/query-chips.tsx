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
import {
	isVariant,
	REQUIREMENT_MODES,
	type Requirement,
	type RequirementMode,
	type Variant,
	withOff,
	withoutVariant,
} from "#/search/requirement";

/**
 * 查询条件：一条要求一枚 chip，可改强度、可删。
 *
 * 它是**系统读出来的东西**，不是查询本身——查询是上面那句原话（见
 * `query-deck.tsx`）。所以这里只做微调：改强度、停用、删掉一枚，都比重写整句
 * 快。说不清哪儿错了的时候，出路在那句话上，不在这排 chip 上。
 *
 * 停用（见 `requirement.ts`）保留词和强度，只让它退出本次检索，
 * 用于快速判断某个条件是否过窄。
 *
 * chip 上只写用户自己的说法。模型补的变体（`Member.tier` 不是 said 的那些）
 * 收在菜单里：它们是系统替用户加的，摆在 chip 上会把「我说的」和「它补的」
 * 混成一排；藏起来不让看则是让一个不该出现的人在屏幕上找不到是哪个词招来的。
 * 所以菜单里逐条列出、逐条可删，chip 上只留一个记号说「这里还有」。
 *
 * 四个动作（改强度、停用、删除、删一个变体）都是对要求列表的一次 map 或
 * filter：改的那一条从原对象展开，其余字段原样带着，没有拼装的机会。
 */

/**
 * 一枚 chip 的静息外观：强度落在 Button 的 variant 上，不另配一套底色。
 * 「必须」是实心的次要底（它是默认，也是最常见的一档），另两档是描边——
 * 描边和实心的差别足够读出「这一枚不一样」，而且不占任何一个色相
 * （全站的色相已经各有其主，见 `evidence.tsx`）。
 */
const MODE_VARIANT: Record<RequirementMode, "secondary" | "outline"> = {
	must: "secondary",
	boost: "outline",
	exclude: "outline",
};

/** chip 的尺码。和 `MODE_VARIANT` 一起，构成 chip 静息态的全部外观。 */
const CHIP_SIZE = "xs" as const;

const MODE_LABEL: Record<RequirementMode, string> = {
	must: "必须",
	boost: "加分",
	exclude: "排除",
};

const MODE_HINT: Record<RequirementMode, string> = {
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
 *
 * 减号画的是真正的减号 U+2212，不是 ASCII 的 `-`：它和加号同宽同高，
 * 一列 chip 的符号位才对得齐。
 */
const MODE_GLYPH: Record<RequirementMode, string> = {
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

/**
 * 变体在菜单里的档位说明。用字不用分数：分数在 `weights.ts`，会调；
 * 这里答的是「它和你说的是什么关系」。
 */
const TIER_LABEL: Record<Variant["tier"], string> = {
	same: "同义",
	near: "相近",
};

/** chip 上「这里还有变体」的记号。≈ 是「差不多」最省字的写法，证据行上也用它。 */
const VARIANT_GLYPH = "≈";

export function QueryChips({
	requirements,
	wide,
	onChange,
}: {
	/** 这条查询的证据要求，一条一枚 chip。 */
	requirements: readonly Requirement[];
	/** 这次理解里被判成太宽的词。它解释「这一枚为什么是停用的」，不改变停用本身。 */
	wide: ReadonlySet<string>;
	onChange: (next: Requirement[]) => void;
}) {
	if (requirements.length === 0) return null;

	const replaceAt = (i: number, next: Requirement) =>
		onChange(requirements.map((r, j) => (j === i ? next : r)));
	const remove = (i: number) =>
		onChange(requirements.filter((_, j) => j !== i));
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{requirements.map((chip, i) => {
				const term = chip.members[0].text;
				const tooWide = wide.has(term);
				const said = chip.members.filter((m) => !isVariant(m));
				const variants = chip.members.filter(isVariant);
				return (
					<Menu key={`${chip.off ? "~" : ""}${chip.mode}:${term}`}>
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
							{MODE_GLYPH[chip.mode] && (
								<span className="font-mono text-muted-foreground">
									{MODE_GLYPH[chip.mode]}
								</span>
							)}
							{/* 用户自己的几个说法（或）同权重，平着写；变体不上 chip */}
							<span>{said.map((m) => m.text).join(" / ")}</span>
							{variants.length > 0 && (
								<span className="font-mono text-muted-foreground">
									{VARIANT_GLYPH}
								</span>
							)}
							{/* 「太宽」是成因，得用字说；只给一个停用图标的话，
							    自动停的和自己停的在屏幕上就分不出来了 */}
							{chip.off && tooWide && <span className="text-xs">太宽</span>}
							{chip.off && <EyeOffIcon />}
							<ChevronDownIcon />
						</MenuTrigger>
						<MenuPopup align="start">
							{chip.off && (
								<>
									<MenuGroupLabel>
										<span className="block max-w-64 whitespace-normal text-muted-foreground text-xs">
											{tooWide
												? "这个词命中的人太多，几乎筛不掉谁，已自动停用。" +
													"换个更具体的说法效果更好；重新启用后将照常参与检索。"
												: `此条件当前未生效。重新启用后仍为「${MODE_LABEL[chip.mode]}」条件。`}
										</span>
									</MenuGroupLabel>
									<MenuSeparator />
								</>
							)}
							<MenuRadioGroup
								onValueChange={(mode) =>
									replaceAt(i, { ...chip, mode: mode as RequirementMode })
								}
								value={chip.mode}
							>
								{REQUIREMENT_MODES.map((mode) => (
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
							{variants.length > 0 && (
								<>
									<MenuSeparator />
									<MenuGroupLabel>也按这些说法找</MenuGroupLabel>
									{variants.map((m) => (
										<MenuItem
											key={m.text}
											onClick={() => replaceAt(i, withoutVariant(chip, m.text))}
										>
											{/* 一行三段：变体、它和原话的关系、点了会怎样。
											    删是这一行唯一的动作，所以整行可点，末尾说明白。 */}
											<span className="flex flex-1 items-baseline gap-2">
												<span>{m.text}</span>
												<span className="text-muted-foreground text-xs">
													{TIER_LABEL[m.tier]}
												</span>
												<span className="ml-auto text-muted-foreground text-xs">
													不按它找
												</span>
											</span>
										</MenuItem>
									))}
								</>
							)}
							{/*
							 * 停用和删除挨着放，但不是一档事，所以只有删除是危险色：
							 * 停用改的是这一次检索，删除改的是查询本身，而后者不可撤销
							 * （词没了，强度也一起没了）。
							 */}
							<MenuSeparator />
							<MenuItem onClick={() => replaceAt(i, withOff(chip, !chip.off))}>
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
