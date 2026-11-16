import { AppNavDrawer } from "#/components/ui/app-layout";
import { Button } from "#/components/ui/button";
import { useRecents } from "../-lib/recents";
import { LoadFailed, RecentItem } from "./recent-item";

/**
 * 全部搜索记录，导航栏的「更多」和首页的「查看全部」都打开它。`anchored`（导航栏常驻时）
 * 从导航栏的右缘滑出，点别处不收起；不然贴着窗口左边滑出。列的是已经取到的记录，和导航栏
 * 读同一份；「加载更多」接着取下一页。
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
	const { page, moreFailed, reload, more } = useRecents();

	return (
		<AppNavDrawer
			anchored={anchored}
			onClose={onClose}
			open={open}
			title="全部搜索记录"
		>
			<div className="flex flex-col gap-px px-1 py-px">
				{page === null ? (
					<LoadFailed onRetry={reload} />
				) : (
					<>
						{page.rows.map((record) => (
							<RecentItem key={record.turnId} record={record} />
						))}
						{moreFailed ? (
							<LoadFailed onRetry={more} />
						) : (
							page.next !== null && (
								<Button block className="mt-1" onClick={more} type="text">
									加载更多
								</Button>
							)
						)}
						<p className="p-2 text-fg-tertiary text-xs">
							已列出 {page.rows.length} 条，共 {page.total} 条，最近的在前
						</p>
					</>
				)}
			</div>
		</AppNavDrawer>
	);
}
