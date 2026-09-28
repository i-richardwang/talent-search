import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/* 带标题的一组内容，行尾 `extra` 放这一组的动作。 */

export function GroupCard({
	children,
	className,
	desc,
	extra,
	title,
}: {
	children?: ReactNode;
	className?: string;
	desc?: ReactNode;
	extra?: ReactNode;
	title: ReactNode;
}) {
	return (
		<div className={cn("ui-group-card", className)}>
			<div className="ui-group-card-header">
				<div className="ui-group-card-heading">
					<div className="ui-group-card-title">{title}</div>
					{desc && <div className="ui-group-card-desc">{desc}</div>}
				</div>
				{extra && <div className="ui-group-card-extra">{extra}</div>}
			</div>
			<div className="ui-group-card-body">{children}</div>
		</div>
	);
}
