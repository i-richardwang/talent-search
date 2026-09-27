import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { PageHeader } from "./page-header";

/**
 * 三个管理页（`/data`、`/skills`、`/tasks`）共用的一屏：页头居中说是哪一页，下面一条
 * 可滚动的内容列，居中封在 `--container-admin` 里，上 24px、下 128px、左右 24px，
 * 块与块之间 36px。
 *
 * 标题底下不挂概述：有多少人、上次整理是什么时候，下面的表脚和各组已经在说。
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
					className="mx-auto flex w-full max-w-admin flex-col gap-9 px-6 pt-6 pb-32"
					id="main"
					tabIndex={-1}
				>
					{children}
				</main>
			</ScrollArea>
		</>
	);
}

/**
 * 列表页（`/data`、`/skills`）这一刻是不是在换一批行：地址上的词或页码已经变了，
 * 新的一页还没取回来。打开、关上右侧的详情不算——路径变了，列表那一段地址没变。
 */
export function useListPending(path: "/data" | "/skills") {
	return useRouterState({
		select: (state) =>
			state.status === "pending" &&
			state.location.pathname === path &&
			state.resolvedLocation?.pathname === path &&
			state.location.searchStr !== state.resolvedLocation.searchStr,
	});
}
