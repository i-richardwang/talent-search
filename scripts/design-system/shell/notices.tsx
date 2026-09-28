import { type ReactNode, useEffect, useState } from "react";
import { Alert } from "#/components/ui/alert";

/** 操作结果的提示：四秒后自己消失。 */
export function useNotice() {
	const [notice, setNotice] = useState<string | null>(null);
	useEffect(() => {
		if (!notice) return;
		const timer = window.setTimeout(() => setNotice(null), 4000);
		return () => window.clearTimeout(timer);
	}, [notice]);
	return [notice, setNotice] as const;
}

/** 操作结果的提示；存储写不进时常驻一条。 */
export function Notices({
	notice,
	onDismiss,
	storageFailed,
}: {
	notice: string | null;
	onDismiss: () => void;
	storageFailed: boolean;
}): ReactNode {
	if (!notice && !storageFailed) return null;
	return (
		<div className="pointer-events-none fixed inset-x-4 bottom-6 z-popup flex flex-col items-center gap-2 *:pointer-events-auto">
			{storageFailed && (
				<Alert
					title="浏览器无法保存修改，请导出 CSS 以保留修改。"
					type="warning"
				/>
			)}
			{notice && (
				<Alert
					onClose={onDismiss}
					role="status"
					title={notice}
					type="success"
				/>
			)}
		</div>
	);
}
