"use client";

import { Dialog } from "@base-ui/react/dialog";
import { motion } from "motion/react";
import {
	createContext,
	use,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { backdropTransition } from "#/components/ui/motion-token";

/*
 * 对话框与抽屉共用的开合状态。`open` 受控；关上时根先留在树里，面板放完出场动画
 * （面板里的 `AnimatePresence` 调 `onExitComplete`）再卸掉。Base UI 的 Dialog 在根
 * 挂着期间一直是开着的，进出场全由 motion 放。
 */

interface DialogPresence {
	onExitComplete: () => void;
	open: boolean;
}

const DialogPresenceContext = createContext<DialogPresence>({
	onExitComplete: () => undefined,
	open: false,
});

/** 面板与背板读开合状态和出场回调。 */
export const useDialogPresence = () => use(DialogPresenceContext);

type DialogPresenceRootProps = Pick<
	Dialog.Root.Props,
	"children" | "modal" | "onOpenChange"
> & {
	/** 面板出场、根卸掉之后调用。 */
	onExitComplete?: () => void;
	open: boolean;
};

export function DialogPresenceRoot({
	open,
	children,
	modal = true,
	onExitComplete: onExitCompleteProp,
	onOpenChange,
}: DialogPresenceRootProps) {
	const [isPresent, setIsPresent] = useState(open);

	useEffect(() => {
		if (open) setIsPresent(true);
	}, [open]);

	const onExitComplete = useCallback(() => {
		setIsPresent(false);
		onExitCompleteProp?.();
	}, [onExitCompleteProp]);

	const presence = useMemo(
		() => ({ onExitComplete, open }),
		[onExitComplete, open],
	);

	if (!isPresent) return null;

	return (
		<DialogPresenceContext value={presence}>
			<Dialog.Root modal={modal} onOpenChange={onOpenChange} open>
				{children}
			</Dialog.Root>
		</DialogPresenceContext>
	);
}

/** 背板：跟着 `open` 淡入淡出，时长与曲线读动效令牌（见 motion-token.ts）。 */
export function DialogPresenceBackdrop({ className }: { className: string }) {
	const { open } = useDialogPresence();
	return (
		<Dialog.Backdrop
			className={className}
			render={
				<motion.div
					animate={{ opacity: open ? 1 : 0 }}
					initial={{ opacity: 0 }}
					transition={backdropTransition()}
				/>
			}
		/>
	);
}
