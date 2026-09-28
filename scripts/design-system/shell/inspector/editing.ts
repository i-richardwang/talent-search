import type { Draft, TokenPreview } from "../../shared/tokens/draft";

/** 右栏各节改令牌要的：当前的修改、叠上拖动中的值后的样子，以及提交与预览两个回调。 */
export interface Editing {
	draft: Draft;
	/** 叠上拖动中的那个值；读数和色块按它画。 */
	previewDraft: Draft;
	onEdit: (draft: Draft) => void;
	/** 拖动中的值；放弃或松手时是 null。 */
	onPreview: (preview: TokenPreview | null) => void;
}
