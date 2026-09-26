import { RotateCcw } from "lucide-react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Segmented } from "#/components/ui/segmented";
import { ModifiedMark } from "../../shared/marks";
import { tokenValue, updateToken } from "../../shared/source";
import { resetTokens } from "../../shared/tokens/draft";
import { EASINGS, type EasingToken } from "../../shared/tokens/registry";
import type { Editing } from "./editing";

/** 缓动：每个令牌一排，从几条常用曲线里选；改过的可以单独恢复原版值。 */
export function EasingFields({
	editing: { draft, onEdit },
	tokens,
}: {
	editing: Editing;
	tokens: EasingToken[];
}) {
	return (
		<div className="mt-3.5 flex flex-col gap-3">
			{tokens.map(({ key, label }) => (
				<div className="flex flex-col gap-1.5" key={key}>
					<span className="flex items-center gap-1.5 text-fg-secondary">
						{label}
						{key in draft.shared && (
							<>
								<ModifiedMark />
								<ActionIcon
									className="ml-auto"
									icon={RotateCcw}
									onClick={() => onEdit(resetTokens(draft, "shared", [key]))}
									size="small"
									title={`${label}恢复原版值`}
								/>
							</>
						)}
					</span>
					<Segmented<string>
						aria-label={label}
						block
						onChange={(next) => onEdit(updateToken(draft, "shared", key, next))}
						options={EASINGS.map(([easing, name]) => ({
							label: name,
							title: easing,
							value: easing,
						}))}
						size="small"
						value={tokenValue(draft, "shared", key)}
					/>
				</div>
			))}
		</div>
	);
}
