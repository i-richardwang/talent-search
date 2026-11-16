import {
	EllipsisIcon,
	LinkIcon,
	MessageSquareTextIcon,
	TextSearchIcon,
	TrashIcon,
} from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
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
import { NavGroup, NavGroups, NavItem } from "#/components/ui/nav-item";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

/** 合成的几条搜索记录。 */
const RECORDS = [
	{ icon: MessageSquareTextIcon, id: "a", label: "做过推荐系统的后端" },
	{ icon: TextSearchIcon, id: "b", label: "Flink · 3 年以上" },
	{
		icon: MessageSquareTextIcon,
		id: "c",
		label: "带过十人以上团队的测试负责人",
	},
];

function Playground() {
	const [danger, setDanger] = useState(true);
	const [picked, setPicked] = useState<string | null>(null);
	const items: DropdownItem[] = [
		{
			icon: LinkIcon,
			key: "copy",
			label: "复制链接",
			onClick: () => setPicked("复制链接"),
		},
		...(danger
			? [
					{ type: "divider" as const },
					{
						danger: true,
						icon: TrashIcon,
						key: "delete",
						label: "删除",
						onClick: () => setPicked("删除"),
					},
				]
			: []),
	];
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={danger} onChange={setDanger}>
						危险项
					</Checkbox>
				</Control>
			</Controls>
			<Stage footer={<span>上一次点的是 {picked ?? "（还没有）"}</span>}>
				<ContextMenu menu={renderDropdownMenuItems(items)}>
					<Block
						className="h-40 w-full max-w-(--container-nav) items-center justify-center text-fg-tertiary text-sm"
						variant="outlined"
					>
						在这里按右键，触屏上长按
					</Block>
				</ContextMenu>
			</Stage>
		</div>
	);
}

/** 一条搜索记录的菜单项：行尾「…」和右键共用这一份。 */
const recordItems = (onPick: (label: string) => void): DropdownItem[] => [
	{
		icon: LinkIcon,
		key: "copy",
		label: "复制链接",
		onClick: () => onPick("复制链接"),
	},
	{
		danger: true,
		icon: TrashIcon,
		key: "delete",
		label: "删除",
		onClick: () => onPick("删除"),
	},
];

function RecentGroupSample() {
	const [open, setOpen] = useState(["recent"]);
	const [picked, setPicked] = useState<string | null>(null);
	return (
		<div className="flex w-full max-w-(--container-nav) flex-col gap-2">
			<NavGroups onValueChange={setOpen} value={open}>
				<NavGroup title="最近搜索" value="recent">
					{RECORDS.map((record) => {
						const items = recordItems((label) =>
							setPicked(`${record.label} · ${label}`),
						);
						return (
							<ContextMenu
								key={record.id}
								menu={renderDropdownMenuItems(items)}
							>
								<NavItem
									actions={
										<DropdownMenuRoot>
											<DropdownMenuTrigger>
												<ActionIcon
													aria-label={`「${record.label}」的更多操作`}
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
									icon={record.icon}
									iconSize="small"
									render={<button type="button" />}
								>
									{record.label}
								</NavItem>
							</ContextMenu>
						);
					})}
				</NavGroup>
			</NavGroups>
			<span className="px-2 text-fg-tertiary text-xs">
				上一次点的是 {picked ?? "（还没有）"}
			</span>
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="按在一条记录上右键，打开那一条自己的菜单（复制链接、删除），和行尾「…」是同一份项。"
				title="最近搜索"
			>
				<RecentGroupSample />
			</Example>
		</ExampleGrid>
	);
}

export function ContextMenuPage() {
	return (
		<DocPage
			facts={["在指针处打开", "项与下拉菜单同一套"]}
			rules={{
				notes: [
					"只给已经有「…」菜单的东西加右键菜单，项和「…」打开的是同一份，不多也不少。",
					"弹层、项、子菜单都用下拉菜单的 renderDropdownMenuItems 与原子件；右键菜单只管在哪儿打开，没有展开动画。",
					"触发区不占版面，包住的元素按平常排。",
					"触屏上长按打开；键盘用户走行尾的「…」，右键菜单不是唯一的入口。",
				],
				usage: `<ContextMenu menu={renderDropdownMenuItems(items)}>\n  <NavItem actions={…} icon={…} render={<Link … />}>\n    做过推荐系统的后端\n  </NavItem>\n</ContextMenu>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用右键菜单" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
