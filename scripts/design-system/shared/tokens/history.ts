import type { Draft } from "./draft";

/** 撤销与重做记的步数。 */
export const HISTORY_LIMIT = 100;

export interface History {
	past: Draft[];
	present: Draft;
	future: Draft[];
}

type EditAction =
	| { type: "edit"; draft: Draft }
	| { type: "undo" }
	| { type: "redo" };

/** 撤销与重做：最多记 `HISTORY_LIMIT` 步；和现在一样的修改不进记录。 */
export function editHistory(state: History, action: EditAction): History {
	if (action.type === "edit") {
		if (JSON.stringify(state.present) === JSON.stringify(action.draft))
			return state;
		return {
			future: [],
			past: [...state.past.slice(1 - HISTORY_LIMIT), state.present],
			present: action.draft,
		};
	}
	if (action.type === "undo") {
		const previous = state.past.at(-1);
		return previous
			? {
					future: [state.present, ...state.future],
					past: state.past.slice(0, -1),
					present: previous,
				}
			: state;
	}
	const [next, ...rest] = state.future;
	return next
		? { future: rest, past: [...state.past, state.present], present: next }
		: state;
}
