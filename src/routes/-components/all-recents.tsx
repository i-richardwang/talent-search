import { useCallback, useEffect, useState } from "react";
import { AppNavDrawer } from "#/components/ui/app-layout";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { recentSearches } from "#/server/functions";
import type { RecentSearch } from "#/server/turn";
import { RECENT_FIRST_PAGE } from "../-lib/recent";
import { LoadFailed, RecentItem } from "./recent-item";

type Loaded = { rows: RecentSearch[]; total: number; page: number };

/**
 * 全部搜索记录：从导航栏「更多」打开。宽屏上从导航栏的右缘滑出、盖在内容卡片上，
 * 点别处不收起，一边开着一边照常用导航栏和卡片；窄屏上导航本身在抽屉里，它贴着
 * 窗口左边滑出。打开时取第一页，翻到底按「加载更多」接着取下一页，底下写着已列出
 * 几条、一共几条。
 */
export function AllRecentsDrawer({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);

	const load = useCallback(async (page: number) => {
		setLoading(true);
		setFailed(false);
		try {
			const next = await recentSearches({
				data: { page, size: RECENT_FIRST_PAGE },
			});
			setLoaded((current) => ({
				page: next.page,
				rows:
					page === 1 || !current ? next.rows : [...current.rows, ...next.rows],
				total: next.total,
			}));
		} catch {
			setFailed(true);
		} finally {
			setLoading(false);
		}
	}, []);

	// 每次打开都从第一页取起：关着的时候可能又搜过、删过
	useEffect(() => {
		if (open) void load(1);
		else setLoaded(null);
	}, [open, load]);

	const removed = (turnId: string) =>
		setLoaded(
			(current) =>
				current && {
					...current,
					rows: current.rows.filter((r) => r.turnId !== turnId),
					total: current.total - 1,
				},
		);

	return (
		<AppNavDrawer anchored onClose={onClose} open={open} title="全部搜索记录">
			<div className="flex flex-col gap-px px-1 py-px">
				{loaded === null ? (
					failed ? (
						<LoadFailed onRetry={() => void load(1)} retrying={loading} />
					) : (
						<RecentSkeleton rows={5} />
					)
				) : (
					<>
						{loaded.rows.map((record) => (
							<RecentItem
								key={record.turnId}
								onRemoved={removed}
								record={record}
							/>
						))}
						{failed ? (
							<LoadFailed
								onRetry={() => void load(loaded.page + 1)}
								retrying={loading}
							/>
						) : (
							loaded.rows.length < loaded.total && (
								<Button
									block
									className="mt-1"
									loading={loading}
									onClick={() => void load(loaded.page + 1)}
									type="text"
								>
									加载更多
								</Button>
							)
						)}
						<p className="p-2 text-fg-tertiary text-xs">
							已列出 {loaded.rows.length} 条，共 {loaded.total} 条，最近的在前
						</p>
					</>
				)}
			</div>
		</AppNavDrawer>
	);
}

/** 导航项形状的占位：和一行记录同高（36px），一块 28px 的方块和一条 16px 高的横条。 */
function RecentSkeleton({ rows }: { rows: number }) {
	return (
		<div aria-hidden className="flex flex-col gap-0.5">
			{Array.from({ length: rows }, (_, index) => (
				<div
					className="flex h-9 items-center gap-2 p-1.5"
					// biome-ignore lint/suspicious/noArrayIndexKey: 占位行只按位置区分
					key={index}
				>
					<Skeleton className="shrink-0" height={28} width={28} />
					<Skeleton height={16} />
				</div>
			))}
		</div>
	);
}
