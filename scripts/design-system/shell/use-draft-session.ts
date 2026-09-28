import { useEffect, useReducer, useState } from "react";
import { pruneDraft } from "../shared/source";
import type { Draft } from "../shared/tokens/draft";
import { editHistory } from "../shared/tokens/history";
import { loadSession, MAX_SCHEMES, type Scheme, saveSession } from "./storage";

/**
 * 这台浏览器里的修改与方案：修改带撤销与重做，方案可以存、载入、删除；
 * 两样一变就写回 localStorage，写不进时 `storageFailed` 为真。读回的修改先去掉
 * 已经和源文件相同的项（源文件在两次打开之间改过）。
 */
export function useDraftSession() {
	const [session] = useState(loadSession);
	const [history, dispatch] = useReducer(editHistory, {
		future: [],
		past: [],
		present: pruneDraft(session.draft),
	});
	const draft = history.present;
	const [schemes, setSchemes] = useState<Scheme[]>(session.schemes);
	const [storageFailed, setStorageFailed] = useState(false);

	useEffect(() => {
		setStorageFailed(!saveSession({ draft, schemes }));
	}, [draft, schemes]);

	return {
		canRedo: history.future.length > 0,
		canUndo: history.past.length > 0,
		deleteScheme: (id: string) =>
			setSchemes(schemes.filter((scheme) => scheme.id !== id)),
		draft,
		edit: (next: Draft) => dispatch({ draft: next, type: "edit" }),
		/** 载入一个方案：替换当前的修改，可以撤销。 */
		loadScheme: (scheme: Scheme) =>
			dispatch({ draft: pruneDraft(scheme.draft), type: "edit" }),
		redo: () => dispatch({ type: "redo" }),
		/** 把当前的修改存成一个方案，排在最前；超过上限时最旧的挤掉。 */
		saveScheme: (name: string) =>
			setSchemes(
				[
					{
						draft,
						id: crypto.randomUUID(),
						name,
						savedAt: new Date().toISOString(),
					},
					...schemes,
				].slice(0, MAX_SCHEMES),
			),
		schemes,
		storageFailed,
		undo: () => dispatch({ type: "undo" }),
	};
}

export type DraftSession = ReturnType<typeof useDraftSession>;
