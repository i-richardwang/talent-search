import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { recentSearches } from "#/server/functions";
import type { RecentPage } from "#/server/turn";
import { RECENT_PAGE_SIZE } from "./recent";

/*
 * 最近搜索只有一份：导航栏、首页和全部记录的抽屉读的是同一份已经取到的记录，各自切各自要的
 * 那几条。第一页随根路由直出；之后什么时候重取都在这里——记了一条新的查询记录、删了一条、
 * 有任务 AI 还在处理、上一次没取到——三处一起变。
 */

export type Recents = {
	/** 已经取到的记录，最近的在前；一次都没取到为 null。 */
	page: RecentPage | null;
	/** 接着取下一页没取到：已经取到的照常显示，给重试。 */
	moreFailed: boolean;
	/** 把已经取到的这么多条重取一遍：翻过的页不收回去。 */
	reload: () => Promise<void>;
	/** 接着取下一页。 */
	more: () => Promise<void>;
};

const RecentsContext = createContext<Recents | null>(null);

export function useRecents(): Recents {
	const recents = use(RecentsContext);
	if (!recents) throw new Error("最近搜索要在 RecentsProvider 里读");
	return recents;
}

/** 有任务还在处理时多久重取一次。 */
const FOLLOW_POLL_MS = 3000;

/** `initial` 是根路由直出的第一页，没取到为 null。 */
export function RecentsProvider({
	initial,
	children,
}: {
	initial: RecentPage | null;
	children: ReactNode;
}) {
	const [page, setPage] = useState(initial);
	const [moreFailed, setMoreFailed] = useState(false);
	// 同一时刻只认最后发出的那一次：重取和取下一页交错时，先发的回来也不用；没有在途的为 null
	const pending = useRef<AbortController | null>(null);
	const listed = page?.rows.length ?? 0;
	const next = page?.next ?? null;

	const fetchRows = useCallback(
		async (after: string | null, size: number): Promise<RecentPage | null> => {
			pending.current?.abort();
			const request = new AbortController();
			pending.current = request;
			try {
				const fetched = await recentSearches({
					data: { after, size },
					signal: request.signal,
				});
				return request.signal.aborted ? null : fetched;
			} catch (error) {
				if (request.signal.aborted) return null;
				throw error;
			} finally {
				if (pending.current === request) pending.current = null;
			}
		},
		[],
	);

	const reload = useCallback(async () => {
		try {
			const fetched = await fetchRows(null, Math.max(listed, RECENT_PAGE_SIZE));
			if (!fetched) return;
			setPage(fetched);
			setMoreFailed(false);
		} catch {
			// 没取到：已经取到的留着，下一次重取再试；一次都没取到的仍是没取到
		}
	}, [fetchRows, listed]);

	const more = useCallback(async () => {
		if (next === null) return;
		setMoreFailed(false);
		try {
			const fetched = await fetchRows(next, RECENT_PAGE_SIZE);
			if (!fetched) return;
			setPage(
				(current) =>
					current && { ...fetched, rows: [...current.rows, ...fetched.rows] },
			);
		} catch {
			setMoreFailed(true);
		}
	}, [fetchRows, next]);

	// 有任务 AI 还在处理：人不在那次搜索的页面上，它处理完或没处理成，这一行也跟着变
	const working = page?.rows.some((row) => row.status === "working") ?? false;
	useEffect(() => {
		if (!working) return;
		// 定时的这一次让着人发起的：有请求在途就等下一次，不把「加载更多」顶掉
		const timer = window.setInterval(() => {
			if (!pending.current) void reload();
		}, FOLLOW_POLL_MS);
		return () => window.clearInterval(timer);
	}, [working, reload]);

	return (
		<RecentsContext value={{ page, moreFailed, reload, more }}>
			{children}
		</RecentsContext>
	);
}

/** 一份不会变的最近搜索：设计系统的预览页用样例数据画读它的组件。 */
export function StaticRecents({
	page,
	children,
}: {
	page: RecentPage | null;
	children: ReactNode;
}) {
	return (
		<RecentsContext
			value={{
				page,
				moreFailed: false,
				reload: async () => {},
				more: async () => {},
			}}
		>
			{children}
		</RecentsContext>
	);
}
