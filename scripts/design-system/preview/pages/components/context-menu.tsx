import {
	CheckIcon,
	HashIcon,
	LinkIcon,
	MessageSquareTextIcon,
	MoreHorizontalIcon,
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
	DropdownMenuItemContent,
	DropdownMenuItemExtra,
	DropdownMenuItemIcon,
	DropdownMenuItemLabel,
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItemIndicator,
	DropdownMenuRadioItemPrimitive,
	DropdownMenuRoot,
	DropdownMenuSubmenuArrow,
	DropdownMenuSubmenuRoot,
	DropdownMenuSubmenuTrigger,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { Icon } from "#/components/ui/icon";
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

const COUNTS = ["5", "10", "15"] as const;

/** 试用：在一块面上按右键，菜单在指针处打开；可以加上危险项和分隔线。 */
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

/** 导航栏里最近搜索那一组：组名和每一行都有右键菜单，和行尾「…」是同一份。 */
function RecentGroupSample() {
	const [open, setOpen] = useState(["recent"]);
	const [count, setCount] = useState<string>(COUNTS[0]);
	const [picked, setPicked] = useState<string | null>(null);
	const groupMenu = (
		<DropdownMenuSubmenuRoot>
			<DropdownMenuSubmenuTrigger label="显示">
				<DropdownMenuItemContent>
					<DropdownMenuItemIcon>
						<Icon icon={HashIcon} />
					</DropdownMenuItemIcon>
					<DropdownMenuItemLabel>显示</DropdownMenuItemLabel>
					<DropdownMenuItemExtra>{count}</DropdownMenuItemExtra>
					<DropdownMenuSubmenuArrow />
				</DropdownMenuItemContent>
			</DropdownMenuSubmenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuPositioner submenu>
					<DropdownMenuPopup>
						<DropdownMenuRadioGroup
							onValueChange={(next) => setCount(next as string)}
							value={count}
						>
							{COUNTS.map((n) => (
								<DropdownMenuRadioItemPrimitive
									key={n}
									label={`${n} 条`}
									value={n}
								>
									<DropdownMenuItemContent>
										<DropdownMenuItemIcon>
											<DropdownMenuRadioItemIndicator>
												<Icon icon={CheckIcon} />
											</DropdownMenuRadioItemIndicator>
										</DropdownMenuItemIcon>
										<DropdownMenuItemLabel>{n} 条</DropdownMenuItemLabel>
									</DropdownMenuItemContent>
								</DropdownMenuRadioItemPrimitive>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuPopup>
				</DropdownMenuPositioner>
			</DropdownMenuPortal>
		</DropdownMenuSubmenuRoot>
	);
	return (
		<div className="flex w-full max-w-(--container-nav) flex-col gap-2">
			<NavGroups onValueChange={setOpen} value={open}>
				<ContextMenu menu={groupMenu}>
					<NavGroup
						action={
							<DropdownMenuRoot>
								<DropdownMenuTrigger>
									<ActionIcon
										aria-label="最近搜索的更多操作"
										icon={MoreHorizontalIcon}
										size="small"
									/>
								</DropdownMenuTrigger>
								<DropdownMenuPortal>
									<DropdownMenuPositioner>
										<DropdownMenuPopup>{groupMenu}</DropdownMenuPopup>
									</DropdownMenuPositioner>
								</DropdownMenuPortal>
							</DropdownMenuRoot>
						}
						title="最近搜索"
						value="recent"
					>
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
														icon={MoreHorizontalIcon}
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
				</ContextMenu>
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
				description="组名上按右键是这一组的菜单（列几条）；按在一条记录上只开那一条自己的菜单（复制链接、删除）。两处都和行尾「…」是同一份项。"
				title="最近搜索"
			>
				<RecentGroupSample />
			</Example>
		</ExampleGrid>
	);
}

/** 右键菜单页：试用、使用场景。 */
export function ContextMenuPage() {
	return (
		<DocPage
			facts={["在指针处打开", "项与下拉菜单同一套", "可嵌套"]}
			rules={{
				notes: [
					"只给已经有「…」菜单的东西加右键菜单，项和「…」打开的是同一份，不多也不少。",
					"弹层、项、子菜单都用下拉菜单的 renderDropdownMenuItems 与原子件；右键菜单只管在哪儿打开，没有展开动画。",
					"触发区不占版面，包住的元素照常排；里面再有右键菜单时，按在里面那一块上只开里面那一个。",
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
