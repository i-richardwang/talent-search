import { useRouterState } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { PageHeader } from "./page-header";

/** 三个管理页（`/data`、`/skills`、`/tasks`）共用的一屏：居中的页头和一条可滚动的内容列。 */
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
			<ScrollArea className="min-h-0 flex-1">
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

/** 列表页一个链接指向的那一页。页码和词总是一起走：换了词，页码就不是同一批行了。 */
export function listSearch(page: number, q: string) {
	return { page: page > 1 ? page : undefined, q };
}

/**
 * 列表页找词框里的草稿，跟随地址上的 `q`：后退、前进或从别的链接进来时回到那一次的词，
 * 输入框和下面的表才说的是同一件事。在渲染中同步而不放进 effect：effect 要等这一帧
 * 画完才跑，那一帧是新表配旧词。自己提交的那次 `q` 等于草稿，是一次同值 setState。
 */
export function useSearchDraft(q: string) {
	const [draft, setDraft] = useState(q);
	const seen = useRef(q);
	if (seen.current !== q) {
		seen.current = q;
		setDraft(q);
	}
	return [draft, setDraft] as const;
}
