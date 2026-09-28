import { Trash2 } from "lucide-react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Button } from "#/components/ui/button";
import { Empty } from "#/components/ui/empty";
import { Swatch } from "../../shared/marks";
import { tokenValue } from "../../shared/source";
import { changeCount } from "../../shared/tokens/draft";
import { MAX_SCHEMES, type Scheme } from "../storage";
import { ChangesPanel } from "./panel";

/** 「保存方案」：存在这台浏览器里的方案；载入会替换当前的修改（可以撤销）。 */
export function SavedSchemes({
	onDelete,
	onLoad,
	onSave,
	schemes,
}: {
	onDelete: (id: string) => void;
	onLoad: (scheme: Scheme) => void;
	onSave: () => void;
	schemes: Scheme[];
}) {
	return (
		<ChangesPanel
			actions={
				<Button onClick={onSave} type="primary">
					保存方案
				</Button>
			}
		>
			{schemes.length === 0 ? (
				<Empty
					description={`调好的修改可以存成方案，保存在这台浏览器里，最多 ${MAX_SCHEMES} 个。`}
					title="还没有保存的方案"
				/>
			) : (
				<section aria-labelledby="saved-schemes-title">
					<h2
						className="flex items-center justify-between border-border-secondary border-b pb-2.5 text-fg-secondary text-xs"
						id="saved-schemes-title"
					>
						已存方案
						<span className="font-mono tabular-nums">{schemes.length}</span>
					</h2>
					<ul className="flex flex-col">
						{schemes.map((scheme) => (
							<li
								className="flex items-center gap-3 border-border-secondary border-b py-2.5 last:border-b-0"
								key={scheme.id}
							>
								<Swatch
									className="size-3 rounded-full"
									color={tokenValue(scheme.draft, "light", "--color-primary")}
								/>
								<Button
									className="min-w-0 flex-1 justify-start"
									onClick={() => onLoad(scheme)}
									title={`载入「${scheme.name}」`}
									type="text"
								>
									<span className="truncate">{scheme.name}</span>
								</Button>
								<span className="text-fg-tertiary text-xs tabular-nums">
									{changeCount(scheme.draft)} 项 ·{" "}
									{new Date(scheme.savedAt).toLocaleString("zh-CN", {
										day: "numeric",
										hour: "2-digit",
										minute: "2-digit",
										month: "numeric",
									})}
								</span>
								<ActionIcon
									icon={Trash2}
									onClick={() => onDelete(scheme.id)}
									size="small"
									title={`删除「${scheme.name}」`}
								/>
							</li>
						))}
					</ul>
				</section>
			)}
		</ChangesPanel>
	);
}
