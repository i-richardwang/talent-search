import { createContext, use } from "react";
import { type CatalogPage, requirePage } from "../shared/catalog";
import type { PreviewState } from "../shared/protocol";
import { tokenValue } from "../shared/source";
import {
	COMPONENT_TIERS,
	type ComponentSizing,
	componentLabel,
	numericToken,
	numericValue,
	TIER_LABEL,
	type TierOf,
} from "../shared/tokens/registry";

/*
 * 预览页收到的状态，以及各页读它的几个 hook。收到第一份之前预览页不画任何一页，
 * 所以页里总读得到。
 */

export const PreviewStateContext = createContext<PreviewState | null>(null);

/** 页里读当前的状态：修改版、外观、选中的颜色、尺寸档、动效速度。 */
export function usePreviewState(): PreviewState {
	const state = use(PreviewStateContext);
	if (!state) throw new Error("页要画在预览页里");
	return state;
}

/** 正在画的这一页在目录里的那一项。 */
export function useCurrentPage(): CatalogPage {
	return requirePage(usePreviewState().page);
}

/** 读一个数值令牌现在的值（尺寸按像素、时长按毫秒），修改版优先。 */
export function useTokenNumber() {
	const { draft } = usePreviewState();
	return (key: string) => {
		const token = numericToken(key);
		if (!token) throw new Error(`${key} 不是数值令牌`);
		return numericValue(token, tokenValue(draft, "shared", key));
	};
}

/** 右栏正在调的档。外壳只发这个组件有的档，换页时回到中档。 */
export function useTier<G extends ComponentSizing>(group: G): TierOf<G> {
	const { sizeTier } = usePreviewState();
	const tiers: readonly TierOf<G>[] = COMPONENT_TIERS[group];
	const tier = tiers.find((item) => item === sizeTier);
	if (!tier)
		throw new Error(`${componentLabel(group)}没有${TIER_LABEL[sizeTier]}档`);
	return tier;
}
