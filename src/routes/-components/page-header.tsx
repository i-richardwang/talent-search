import { PanelLeftOpenIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { NavHeader, NavHeaderTitle } from "#/components/ui/app-layout";
import { useOpenNav } from "./app-shell";

/**
 * 一屏主栏顶上的页头：标题在左，`right` 放这一屏的动作。lg 以下导航栏不常驻，
 * 左端多一个打开导航的开关。
 *
 * 正文是居中的一列时传 `centered`，标题居中，和正文同一条中线。
 */
export function PageHeader({
	title,
	right,
	centered = false,
}: {
	title: ReactNode;
	right?: ReactNode;
	centered?: boolean;
}) {
	const openNav = useOpenNav();
	const heading = title && (
		<NavHeaderTitle title={typeof title === "string" ? title : undefined}>
			{title}
		</NavHeaderTitle>
	);
	return (
		<NavHeader
			left={
				<>
					{openNav && (
						<ActionIcon
							aria-label="打开导航"
							className="lg:hidden"
							icon={PanelLeftOpenIcon}
							onClick={openNav}
							size="small"
							title="打开导航"
						/>
					)}
					{!centered && heading}
				</>
			}
			right={right}
		>
			{centered && heading && (
				<div className="flex min-w-0 flex-1 justify-center">{heading}</div>
			)}
		</NavHeader>
	);
}
