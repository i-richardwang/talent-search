import type { ChangesPageId } from "../../shared/catalog";
import { emptyDraft } from "../../shared/tokens/draft";
import type { DraftSession } from "../use-draft-session";
import { ApplyToSource } from "./apply";
import { ExportChanges } from "./export";
import { ImpactScope } from "./impact";
import { ReviewChanges } from "./review";
import { SavedSchemes } from "./saved";

/** 修改管理的一页，按页的身份分派。 */
export function ChangesPage({
	id,
	onEdit,
	onExport,
	onNotice,
	onSave,
	session,
}: {
	id: ChangesPageId;
	/** 外壳的提交：先清掉拖动中的值。 */
	onEdit: DraftSession["edit"];
	onExport: () => void;
	onNotice: (message: string) => void;
	onSave: () => void;
	session: DraftSession;
}) {
	const { draft } = session;
	switch (id) {
		case "changes/review":
			return (
				<ReviewChanges draft={draft} onEdit={onEdit} onExport={onExport} />
			);
		case "changes/saved":
			return (
				<SavedSchemes
					onDelete={session.deleteScheme}
					onLoad={(scheme) => {
						session.loadScheme(scheme);
						onNotice(`已载入「${scheme.name}」`);
					}}
					onSave={onSave}
					schemes={session.schemes}
				/>
			);
		case "changes/export":
			return <ExportChanges draft={draft} onNotice={onNotice} />;
		case "changes/impact":
			return <ImpactScope draft={draft} />;
		case "changes/apply":
			return (
				<ApplyToSource
					draft={draft}
					onApplied={() => onEdit(emptyDraft())}
					onNotice={onNotice}
				/>
			);
	}
}
