/** 设计系统测试用的预览状态：给一页，其余取外壳打开这一页时的初值。 */
import type { PreviewPageId } from "../scripts/design-system/shared/catalog";
import {
	INITIAL_PREVIEW,
	type PreviewState,
} from "../scripts/design-system/shared/protocol";
import { emptyDraft } from "../scripts/design-system/shared/tokens/draft";

export const previewState = (
	page: PreviewPageId,
	overrides: Partial<PreviewState> = {},
): PreviewState => ({
	...INITIAL_PREVIEW,
	draft: emptyDraft(),
	page,
	...overrides,
});
