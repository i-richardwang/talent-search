import { Columns2 } from "lucide-react";
import { Button } from "#/components/ui/button";
import type { CatalogPage, PreviewPageId } from "../shared/catalog";
import { ModifiedMark } from "../shared/marks";
import type { PreviewState } from "../shared/protocol";
import { emptyDraft } from "../shared/tokens/draft";
import { UNCHANGED } from "./changes/token-changes";
import { PreviewFrame } from "./preview-frame";

/** 看修改版、只看原版，或两者并排。 */
export type PreviewView = "edited" | "original" | "compare";

/**
 * 画在预览里的页的中间一栏：一行写有几项修改，右边切「查看原版」「并排对比」；下面是一块或两块预览框。
 */
export function PreviewArea({
	changes,
	onSelectColor,
	onView,
	page,
	state,
	view,
}: {
	/** 当前有几项修改。 */
	changes: number;
	onSelectColor: (token: string) => void;
	onView: (view: PreviewView) => void;
	page: CatalogPage & { id: PreviewPageId };
	state: Omit<PreviewState, "page" | "speed">;
	view: PreviewView;
}) {
	return (
		<>
			<div className="flex items-center gap-2 px-7 pb-2.5 max-xl:px-5">
				<span className="flex items-center gap-2 text-fg-secondary text-xs">
					{changes > 0 && <ModifiedMark />}
					{changes === 0 ? UNCHANGED : `${changes} 项修改`}
				</span>
				<div className="ml-auto flex gap-1">
					<Button
						aria-pressed={view === "original"}
						disabled={view === "compare"}
						onClick={() => onView(view === "original" ? "edited" : "original")}
						size="small"
						type={view === "original" ? "fill" : "text"}
					>
						{view === "original" ? "返回修改版" : "查看原版"}
					</Button>
					<Button
						aria-pressed={view === "compare"}
						icon={Columns2}
						onClick={() => onView(view === "compare" ? "edited" : "compare")}
						size="small"
						type={view === "compare" ? "fill" : "text"}
					>
						并排对比
					</Button>
				</div>
			</div>
			<div className="flex min-h-0 flex-1 gap-4 overflow-auto px-7 pb-5 max-xl:px-5">
				{(view === "compare" ? [true, false] : [view === "original"]).map(
					(original) => (
						<PreviewFrame
							compare={view === "compare"}
							key={String(original)}
							motion={page.motion !== undefined}
							onSelectColor={onSelectColor}
							original={original}
							state={{
								...state,
								draft: original ? emptyDraft() : state.draft,
								page: page.id,
							}}
						/>
					),
				)}
			</div>
		</>
	);
}
