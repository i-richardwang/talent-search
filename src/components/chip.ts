import type { ChipMode } from "#/search/parse";

/**
 * 一枚条件 chip 的静息外观。
 *
 * 住在这一层是因为**两屏都要画它**：工作台上那排可编辑的 chip
 * （`routes/-components/query-chips.tsx`），和零态那排「常用方向」
 * （`routes/-components/zero-state.tsx`）——后者点下去得到的正是一枚必须词 chip，
 * 所以它必须长成那个样子，否则「点这个会变成什么」这句话就没人替它说。
 *
 * 强度落在 Button 的 variant 上，不另配一套底色。「必须」是实心的次要底（它是默认，
 * 也是最常见的一档），另两档是描边——描边和实心的差别足够读出「这一枚不一样」，
 * 而且不占任何一个色相（全站的色相已经各有其主，见 `evidence.tsx`）。
 */
export const MODE_VARIANT: Record<ChipMode, "secondary" | "outline"> = {
	must: "secondary",
	boost: "outline",
	exclude: "outline",
};

/** chip 的尺码。和 `MODE_VARIANT` 一起，构成 chip 静息态的全部外观。 */
export const CHIP_SIZE = "xs" as const;
