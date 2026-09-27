import type { ReactNode } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { PageHeader } from "./page-header";

/**
 * 三个管理页（`/data`、`/skills`、`/tasks`）共用的一屏：页头居中说是哪一页，下面一条
 * 可滚动的内容列，居中封在 `--container-admin` 里。
 *
 * 标题底下不挂概述：有多少人、上次整理是什么时候，下面的表脚和卡片已经在说。
 */
export function AdminPage({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<>
			<PageHeader centered title={title} />
			<ScrollArea className="min-h-0 flex-1" disableContentFit>
				<main
					className="mx-auto flex w-full max-w-admin flex-col gap-6 px-6 pt-2 pb-16"
					id="main"
					tabIndex={-1}
				>
					{children}
				</main>
			</ScrollArea>
		</>
	);
}
