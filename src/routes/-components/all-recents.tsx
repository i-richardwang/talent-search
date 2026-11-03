import { AppNavDrawer } from "#/components/ui/app-layout";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { useRecents } from "../-lib/use-recents";
import { LoadFailed, RecentItem } from "./recent-item";

/**
 * 全部搜索记录，导航栏的「更多」和首页的「查看全部」都打开它。`anchored`（导航栏常驻时）
 * 从导航栏的右缘滑出，点别处不收起；不然贴着窗口左边滑出。「加载更多」接着取下一页。
 */
export function AllRecentsDrawer({
	open,
	onClose,
	anchored,
}: {
	open: boolean;
	onClose: () => void;
	anchored: boolean;
}) {
	const { loaded, loading, failed, load, removed } = useRecents(open);

	return (
		<AppNavDrawer
			anchored={anchored}
			onClose={onClose}
			open={open}
			title="全部搜索记录"
		>
			<div className="flex flex-col gap-px px-1 py-px">
				{loaded === null ? (
					failed ? (
						<LoadFailed onRetry={() => void load(null)} retrying={loading} />
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
								onRetry={() => void load(loaded.next)}
								retrying={loading}
							/>
						) : (
							loaded.next !== null && (
								<Button
									block
									className="mt-1"
									loading={loading}
									onClick={() => void load(loaded.next)}
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

/** 和一行记录同形的占位。 */
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
