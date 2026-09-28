import { RotateCcw } from "lucide-react";
import { Button } from "#/components/ui/button";
import { changeCount, type Draft, emptyDraft } from "../../shared/tokens/draft";
import { ChangesPanel } from "./panel";
import { TokenChanges } from "./token-changes";

/** 「修改记录」：当前的全部修改，可以全部还原或导出。 */
export function ReviewChanges({
	draft,
	onEdit,
	onExport,
}: {
	draft: Draft;
	onEdit: (draft: Draft) => void;
	onExport: () => void;
}) {
	return (
		<ChangesPanel
			actions={
				<>
					<Button
						disabled={changeCount(draft) === 0}
						icon={RotateCcw}
						onClick={() => onEdit(emptyDraft())}
						type="text"
					>
						全部还原
					</Button>
					<Button onClick={onExport}>导出修改</Button>
				</>
			}
		>
			<TokenChanges draft={draft} onEdit={onEdit} />
		</ChangesPanel>
	);
}
