import { Link, useMatch, useNavigate, useParams } from "@tanstack/react-router";
import {
	EllipsisIcon,
	LinkIcon,
	TrashIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Button } from "#/components/ui/button";
import { ContextMenu } from "#/components/ui/context-menu";
import {
	type DropdownItem,
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { Icon } from "#/components/ui/icon";
import { confirmModal } from "#/components/ui/modal";
import { NavItem } from "#/components/ui/nav-item";
import { toast } from "#/components/ui/toast";
import { deleteRecent } from "#/server/functions";
import type { RecentSearch } from "#/server/turn";
import { recentLabel } from "../-lib/recent";
import { useRecents } from "../-lib/recents";
import { SEARCH_MODE_ICON } from "./mode-select";

/**
 * 一行记录的图标：AI 没处理成的任务画警示；否则画搜索方式，链头有原话的是对话，没有的是
 * 关键词搜索。AI 还在处理的任务，图标的位置是转着的圈（行的 `loading`）。
 */
export const recentIcon = (record: Pick<RecentSearch, "status" | "title">) =>
	record.status === "failed"
		? TriangleAlertIcon
		: SEARCH_MODE_ICON[record.title === null ? "keyword" : "conversation"];

/**
 * 删掉一条记录，也就是那一次找人任务的整条链，先确认。人正看着的那一屏就在这条链上
 * 时回首页，留在原地的话下一次载入就是死链。最近搜索重取一遍。
 */
function useRemoveRecent() {
	const { reload } = useRecents();
	const navigate = useNavigate();
	const { turnId: current } = useParams({ strict: false });

	async function remove(record: RecentSearch) {
		try {
			const gone = await deleteRecent({ data: { turnId: record.turnId } });
			if (current && gone.includes(current)) await navigate({ to: "/" });
			await reload();
		} catch {
			toast.error({
				actions: [{ label: "重试", onClick: () => void remove(record) }],
				description: recentLabel(record),
				title: "没能删除这条搜索记录",
			});
		}
	}

	return (record: RecentSearch) =>
		confirmModal({
			content: `「${recentLabel(record)}」这次搜索的全部记录都会删除，删除后无法恢复。`,
			okText: "删除",
			onOk: () => remove(record),
			title: "删除搜索记录",
		});
}

async function copyLink(turnId: string) {
	try {
		await navigator.clipboard.writeText(
			new URL(`/s/${turnId}`, location.origin).toString(),
		);
		toast.success("已复制链接");
	} catch {
		toast.error("没能复制链接");
	}
}

/**
 * 导航栏和全部记录的抽屉里的一行搜索记录；行尾「…」和右键打开同一份菜单。
 * 正开着的那次搜索是当前项，看的是它的哪一轮都算：记录上的 `turnId` 是链上
 * 最后一轮，拿正开着的那条链的最后一轮来比。
 */
export function RecentItem({ record }: { record: RecentSearch }) {
	const latest = useMatch({
		from: "/s/$turnId",
		select: (match) => match.loaderData?.thread.at(-1)?.id,
		shouldThrow: false,
	});
	const remove = useRemoveRecent();
	const label = recentLabel(record);
	const items: DropdownItem[] = [
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
			onClick: () => remove(record),
		},
	];
	return (
		<ContextMenu menu={renderDropdownMenuItems(items)}>
			<NavItem
				actions={
					<DropdownMenuRoot>
						<DropdownMenuTrigger>
							<ActionIcon
								aria-label={`「${label}」的更多操作`}
								icon={EllipsisIcon}
								size="small"
							/>
						</DropdownMenuTrigger>
						<DropdownMenuPortal>
							<DropdownMenuPositioner>
								<DropdownMenuPopup>
									{renderDropdownMenuItems(items)}
								</DropdownMenuPopup>
							</DropdownMenuPositioner>
						</DropdownMenuPortal>
					</DropdownMenuRoot>
				}
				active={record.turnId === latest}
				icon={recentIcon(record)}
				iconSize="small"
				loading={record.status === "working"}
				render={<Link params={{ turnId: record.turnId }} to="/s/$turnId" />}
			>
				{label}
			</NavItem>
		</ContextMenu>
	);
}

/**
 * 最近搜索取不到时的一行。取不到不能借用「还没有记录」那一句：失败该重试，空了该去搜一次。
 */
export function LoadFailed({ onRetry }: { onRetry: () => unknown }) {
	return (
		<div className="flex items-center justify-center gap-2 py-2">
			<Icon className="text-fg-tertiary" icon={TriangleAlertIcon} size={14} />
			<span className="text-fg-secondary text-sm">搜索记录加载失败</span>
			<Button onClick={onRetry} size="small" type="text">
				重试
			</Button>
		</div>
	);
}
