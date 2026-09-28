import type { ReactNode } from "react";
import { NavHeader } from "#/components/ui/app-layout";

/**
 * 右栏一栏的页头：宽屏右栏里的线程和人的详情、窄屏抽屉里的对话都是它。`NavHeader`
 * 的左边是标题，比页头的内边距再往里让 6px，离栏边 14px；右边是这一栏的动作，
 * 关闭钮排在最后。
 */
export function PaneHeader({
	title,
	right,
	className,
}: {
	title: ReactNode;
	right?: ReactNode;
	className?: string;
}) {
	return (
		<NavHeader
			className={className}
			left={
				<div className="ms-1.5 flex min-w-0 items-center gap-2">{title}</div>
			}
			right={right}
		/>
	);
}
