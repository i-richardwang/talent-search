import { useEffect, useRef } from "react";
import { listenToShell } from "../shared/protocol";

/**
 * 接外壳工具条发来的打开、关闭、重播，开合页里的一个弹层（对话框或抽屉）。
 * 重播时关着就直接打开；开着就先关上，等出场放完再打开。出场放完以弹层的
 * `afterClose` 为准：把返回的回调交给它。
 */
export function useMotionCommands(
	open: boolean,
	setOpen: (open: boolean) => void,
): () => void {
	const current = useRef({ open, setOpen });
	current.current = { open, setOpen };
	/** 关上之后要不要重新打开：重播时置上，出场放完时消费。 */
	const reopen = useRef(false);

	useEffect(
		() =>
			listenToShell((message) => {
				if (message.type !== "design-system:motion") return;
				const { open, setOpen } = current.current;
				reopen.current = false;
				if (message.action === "open") setOpen(true);
				else if (message.action === "close") setOpen(false);
				else if (!open) setOpen(true);
				else {
					reopen.current = true;
					setOpen(false);
				}
			}),
		[],
	);

	return useRef(() => {
		if (!reopen.current) return;
		reopen.current = false;
		current.current.setOpen(true);
	}).current;
}
