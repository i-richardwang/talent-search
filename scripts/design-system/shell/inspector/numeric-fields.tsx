import { tokenValue, updateToken } from "../../shared/source";
import { resetTokens } from "../../shared/tokens/draft";
import {
	editUnit,
	formatNumeric,
	type NumericToken,
	numericValue,
} from "../../shared/tokens/registry";
import { NumberField } from "../number-field";
import type { Editing } from "./editing";

/** 一组数值令牌（尺寸或时长），两列排开；改过的可以单独还原。 */
export function NumericFields({
	editing: { draft, onEdit, onPreview, previewDraft },
	tokens,
}: {
	editing: Editing;
	tokens: NumericToken[];
}) {
	return (
		<div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
			{tokens.map((token) => (
				<NumberField
					key={token.key}
					label={token.label}
					max={token.max}
					min={token.min}
					modified={token.key in draft.shared}
					onCommit={(value) =>
						onEdit(
							updateToken(
								draft,
								"shared",
								token.key,
								formatNumeric(token, value),
							),
						)
					}
					onPreview={(value) =>
						onPreview(
							value === null
								? null
								: {
										key: token.key,
										scope: "shared",
										value: formatNumeric(token, value),
									},
						)
					}
					onReset={() => onEdit(resetTokens(draft, "shared", [token.key]))}
					step={token.step}
					symbol={token.symbol}
					token={token.key}
					unit={editUnit(token)}
					value={numericValue(
						token,
						tokenValue(previewDraft, "shared", token.key),
					)}
				/>
			))}
		</div>
	);
}
