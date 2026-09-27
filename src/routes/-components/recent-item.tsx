import {
	Link,
	useNavigate,
	useParams,
	useRouter,
} from "@tanstack/react-router";
import {
	LinkIcon,
	MessageSquareTextIcon,
	MoreHorizontalIcon,
	TextSearchIcon,
	TrashIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Button } from "#/components/ui/button";
import {
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { Icon } from "#/components/ui/icon";
import { NavItem } from "#/components/ui/nav-item";
import { toast } from "#/components/ui/toast";
import { deleteRecent } from "#/server/functions";
import type { RecentSearch } from "#/server/turn";
import { recentLabel } from "../-lib/recent";

/** 两种记录各自的图标：和首页搜索方式菜单里两种搜索的图标是同一对。 */
export const RECENT_ICON = {
	conversation: MessageSquareTextIcon,
	keyword: TextSearchIcon,
};

export const recentIcon = (record: Pick<RecentSearch, "title">) =>
	record.title === null ? RECENT_ICON.keyword : RECENT_ICON.conversation;

/**
 * 删掉一条记录，也就是那一次找人任务的整条链。人正看着的那一屏就在这条链上时
 * 回首页，留在原地的话下一次载入就是死链；否则叫根路由重取最近搜索。
 * 删不掉时右下角说一声，带一个重试。
 */
function useRemoveRecent(onRemoved?: (turnId: string) => void) {
	const router = useRouter();
	const navigate = useNavigate();
	const { turnId: current } = useParams({ strict: false });
	const [removing, setRemoving] = useState<string | null>(null);

	async function remove(record: RecentSearch) {
		setRemoving(record.turnId);
		try {
			const gone = await deleteRecent({ data: { turnId: record.turnId } });
			onRemoved?.(record.turnId);
			if (current && gone.includes(current)) await navigate({ to: "/" });
			else await router.invalidate();
		} catch {
			toast.error({
				actions: [{ label: "重试", onClick: () => void remove(record) }],
				description: recentLabel(record),
				title: "没能删除这条搜索记录",
			});
		} finally {
			setRemoving(null);
		}
	}
	return { remove, removing };
}

/** 这条记录的链接，给「复制链接」用。 */
function recentHref(turnId: string) {
	return new URL(`/s/${turnId}`, location.origin).toString();
}

async function copyLink(turnId: string) {
	try {
		await navigator.clipboard.writeText(recentHref(turnId));
		toast.success("已复制链接");
	} catch {
		toast.error("没能复制链接");
	}
}

/**
 * 导航栏和全部记录的抽屉里的一行搜索记录：整行是去那次搜索的链接，行尾一枚「…」
 * 打开这一行的菜单（复制链接、删除），两项各带图标，删除是危险项。
 */
export function RecentItem({
	record,
	onRemoved,
}: {
	record: RecentSearch;
	/** 删掉之后调用，全部记录的抽屉据此从自己取到的那几页里拿掉这一行。 */
	onRemoved?: (turnId: string) => void;
}) {
	const { turnId: current } = useParams({ strict: false });
	const { remove, removing } = useRemoveRecent(onRemoved);
	const label = recentLabel(record);
	return (
		<NavItem
			actions={
				<DropdownMenuRoot>
					<DropdownMenuTrigger>
						<ActionIcon
							aria-label={`「${label}」的更多操作`}
							icon={MoreHorizontalIcon}
							loading={removing === record.turnId}
							size="small"
						/>
					</DropdownMenuTrigger>
					<DropdownMenuPortal>
						<DropdownMenuPositioner>
							<DropdownMenuPopup>
								{renderDropdownMenuItems([
									{
										icon: LinkIcon,
										key: "copy",
										label: "复制链接",
										onClick: () => void copyLink(record.turnId),
									},
									{
										danger: true,
										icon: TrashIcon,
										key: "delete",
										label: "删除",
										onClick: () => void remove(record),
									},
								])}
							</DropdownMenuPopup>
						</DropdownMenuPositioner>
					</DropdownMenuPortal>
				</DropdownMenuRoot>
			}
			active={record.turnId === current}
			icon={recentIcon(record)}
			iconSize="small"
			render={<Link params={{ turnId: record.turnId }} to="/s/$turnId" />}
		>
			{label}
		</NavItem>
	);
}

/**
 * 一列取不到时的一行：一句「加载失败」和一个重试，居中。取不到不能借用「还没有记录」
 * 那一句：那是把一次失败谎报成一个空结果，而两者该做的事正好相反（重试 vs 去搜一次）。
 */
export function LoadFailed({
	onRetry,
	retrying,
}: {
	onRetry: () => void;
	retrying?: boolean;
}) {
	return (
		<div className="flex items-center justify-center gap-2 py-2">
			<Icon className="text-fg-tertiary" icon={TriangleAlertIcon} size={14} />
			<span className="text-fg-secondary text-sm">搜索记录加载失败</span>
			<Button loading={retrying} onClick={onRetry} size="small" type="text">
				重试
			</Button>
		</div>
	);
}

/** 根路由重取一次（最近搜索取不到时的重试）；`retrying` 是正在重取。 */
export function useRetryRoot() {
	const router = useRouter();
	const [retrying, setRetrying] = useState(false);
	async function retry() {
		setRetrying(true);
		try {
			await router.invalidate();
		} finally {
			setRetrying(false);
		}
	}
	return { retry: () => void retry(), retrying };
}
