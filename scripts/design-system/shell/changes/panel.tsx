import type { ReactNode } from "react";
import { Block } from "#/components/ui/block";

/** 修改管理各页共用的面，`actions` 是这一页的动作。 */
export function ChangesPanel({
	actions,
	children,
}: {
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<Block className="max-w-240" gap={16} padding={24} variant="outlined">
			{actions && (
				<div className="flex flex-wrap items-center justify-end gap-2">
					{actions}
				</div>
			)}
			{children}
		</Block>
	);
}
