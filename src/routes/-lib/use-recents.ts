import { useCallback, useEffect, useRef, useState } from "react";
import { recentSearches } from "#/server/functions";
import type { RecentPage } from "#/server/turn";
import { RECENT_FIRST_PAGE } from "./recent";

/** 一次打开期间的历史列表；关闭、重新加载会使在途响应失效。 */
export function useRecents(open: boolean) {
	const [loaded, setLoaded] = useState<RecentPage | null>(null);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);
	const pending = useRef<AbortController | null>(null);
	const load = useCallback(async (after: string | null) => {
		pending.current?.abort();
		const request = new AbortController();
		pending.current = request;
		setLoading(true);
		setFailed(false);
		try {
			const next = await recentSearches({
				data: { after, size: RECENT_FIRST_PAGE },
				signal: request.signal,
			});
			if (request.signal.aborted) return;
			setLoaded((current) => ({
				...next,
				rows: after && current ? [...current.rows, ...next.rows] : next.rows,
			}));
		} catch {
			if (!request.signal.aborted) setFailed(true);
		} finally {
			if (!request.signal.aborted) setLoading(false);
		}
	}, []);
	useEffect(() => {
		setLoaded(null);
		if (open) void load(null);
		return () => pending.current?.abort();
	}, [open, load]);
	const removed = (turnId: string) =>
		setLoaded(
			(current) =>
				current && {
					...current,
					rows: current.rows.filter((row) => row.turnId !== turnId),
					total: current.total - 1,
				},
		);
	return { loaded, loading, failed, load, removed };
}
