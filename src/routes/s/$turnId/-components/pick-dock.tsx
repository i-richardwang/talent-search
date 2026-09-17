import { DownloadIcon, InfoIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPanel,
	DialogPopup,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "#/components/ui/field";
import { Form } from "#/components/ui/form";
import {
	Popover,
	PopoverPopup,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/ui/popover";
import {
	Toolbar,
	ToolbarButton,
	ToolbarGroup,
	ToolbarSeparator,
} from "#/components/ui/toolbar";
import { csvName, download, FIXED, toCsv } from "../-lib/csv";
import type { Pick, Picks } from "../-lib/picks";
import { reachOf } from "../-lib/view-params";

/**
 * 选中人之后浮现的工具条：选了几个，以及对这一批做什么。
 *
 * 固定在名单下沿，不在表头。用户是一边向下浏览一边选的，视线在名单下半部分，
 * 汇总条应当出现在同一区域；放回表头的话，每选一个都要回到页顶确认。
 *
 * 一个人都没选时不渲染：挑人有开始也有结束，只有中间这段需要汇总条。空着时摆
 * 一条「已选 0 人 · 清空 · 导出」，等于在屏幕上留一组既不可用也不会变化的按钮。
 *
 * 计数一段、操作一段，中间用 `ToolbarSeparator` 分开——这是 `Toolbar` 自带的分段
 * 方式（上游 `p-toolbar-1` 的排法），不是用间距拼出来的两组。浮层样式沿用 coss
 * 的浮层配方（`bg-popover` 配 `shadow-lg/5`），不另配更深的阴影：这一屏的层次由
 * 边框和这一档阴影区分。
 */
export function PickDock({
	picks,
	names,
	total,
	onAll,
	loading,
}: {
	picks: Picks;
	/** 这次查询各主张的名字，按屏幕上的顺序。导出时一条一列。 */
	names: string[];
	/** 符合条件的总人数。名单上这几个人只是其中一段。 */
	total: number;
	/** 把够得着的人全都选上：名单没加载完的部分一并加载出来。 */
	onAll: () => void;
	/** 那一步正在跑。按钮据此转圈，人才知道名单在长。 */
	loading: boolean;
}) {
	const { clear, picked, remove, shownIds } = picks;
	// 按名次排，不按点下去的先后：这一批读起来是一份名单，不是我的操作顺序。
	// 清单和导出的表因此同序，核对的时候两边一行对一行。
	const chosen = [...picked.values()].sort((a, b) => a.rank - b.rank);
	if (chosen.length === 0) return null;

	return (
		/* 吸在名单下沿。整条不接鼠标（`pointer-events-none`），只有那块工具栏自己
		   接：它浮在名单上方，一条通栏的透明层会把它盖住的那几块卡片挡掉。 */
		<div className="pointer-events-none sticky bottom-4 z-stick flex justify-center pt-4">
			<Toolbar
				aria-label="已选择的人"
				className="pointer-events-auto items-center bg-popover shadow-lg/5 transition-[opacity,translate] duration-200 ease-out starting:translate-y-2 starting:opacity-0"
			>
				<Chosen chosen={chosen} onList={new Set(shownIds)} onRemove={remove} />
				<ToolbarSeparator orientation="vertical" />
				<ToolbarGroup>
					<ToolbarButton
						onClick={clear}
						render={<Button size="sm" variant="ghost" />}
					>
						清空
					</ToolbarButton>
					<ExportDialog
						loading={loading}
						names={names}
						onAll={onAll}
						picked={chosen}
						reach={reachOf(total)}
						total={total}
					/>
				</ToolbarGroup>
			</Toolbar>
		</div>
	);
}

/**
 * 「已选 N 人」：这个数字本身就是入口。
 *
 * 选中记录是按快照保存的，改过筛选之后会有几个人不在当前名单上（`-lib/picks.ts`
 * 的 `Pick` 开头写了原因），那时屏幕上没有对应的勾选框。一个核对不了的数字等于
 * 无法验证，所以点开后按名次逐行列出这 N 个人，每行都可以移除——不在名单上的人
 * 也只能在这里移除，名单上没有他们的复选框。
 *
 * 默认不展开人名：姓名会随着选中人数增加不断挤压名单的宽度，而名单才是用户正在
 * 读的内容。需要时再打开浮层。它仍然是一个 ghost 按钮，这条工具栏上唯一的主按钮
 * 是右端的导出。
 *
 * 每行只写姓名。这份清单回答的是「选中的是哪几个人」；岗位、部门和证据属于名单
 * 和详情，放进来只会让一行变成两行。
 */
function Chosen({
	chosen,
	onList,
	onRemove,
}: {
	chosen: Pick[];
	/** 此刻名单上有哪些人。不在里面的那几个得说一声，否则这份清单凭空比名单多出几个。 */
	onList: ReadonlySet<string>;
	onRemove: (empId: string) => void;
}) {
	return (
		<Popover>
			{/* 数字变化要播报，作为这次勾选的反馈。用 `aria-live` 而不是
			    `role="status"`：它是一个按钮，按钮不能同时是状态区域。 */}
			<ToolbarButton
				render={
					<PopoverTrigger
						render={
							<Button
								aria-live="polite"
								className="text-muted-foreground"
								size="sm"
								variant="ghost"
							/>
						}
					/>
				}
			>
				已选 <b className="text-foreground tabular-nums">{chosen.length}</b> 人
			</ToolbarButton>
			<PopoverPopup align="start" className="w-64">
				{/* 标题不重复人数：那个数字就在上方 4px 处的按钮上 */}
				<PopoverTitle className="mb-3 text-sm">挑上的人</PopoverTitle>
				{/* 选中上百人也不必自己限高：浮层知道离屏幕边还有多少空间
				    （`--available-height`），超出后在内部滚动。 */}
				<ul className="flex flex-col gap-0.5">
					{chosen.map((one) => (
						<li className="flex items-center gap-2 ps-2" key={one.empId}>
							<span className="min-w-0 flex-1 truncate text-sm">
								{one.name}
							</span>
							{!onList.has(one.empId) && (
								<span className="shrink-0 text-muted-foreground text-xs">
									不在名单上
								</span>
							)}
							<Button
								aria-label={`移除 ${one.name}`}
								onClick={() => onRemove(one.empId)}
								size="icon-xs"
								variant="ghost"
							>
								<XIcon />
							</Button>
						</li>
					))}
				</ul>
			</PopoverPopup>
		</Popover>
	);
}

/**
 * 导出成一份 CSV。
 *
 * 中间隔一层对话框，不是点一下直接下载：这一步要决定的不止一件事——证据要不要
 * 一起导出，以及这份表里是不是符合条件的那些人（下面那条 `Alert`）。列名先展示
 * 出来，是因为拿到表的往往是另一个人，而列一旦确定就无法在 Excel 里补回来。
 */
function ExportDialog({
	picked,
	names,
	total,
	reach,
	onAll,
	loading,
}: {
	picked: Pick[];
	names: string[];
	total: number;
	/** 这次查询够得着的人有几个（`reachOf`）。 */
	reach: number;
	onAll: () => void;
	loading: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [evidence, setEvidence] = useState(true);
	const on = evidence && names.length > 0;

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<ToolbarButton render={<DialogTrigger render={<Button size="sm" />} />}>
				<DownloadIcon />
				导出 {picked.length} 人
			</ToolbarButton>
			<DialogPopup className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>导出这 {picked.length} 人</DialogTitle>
					<DialogDescription>
						一份 CSV，Excel 和飞书表格都打得开。
					</DialogDescription>
				</DialogHeader>
				<Form
					className="contents"
					onSubmit={(event) => {
						event.preventDefault();
						download(csvName(), toCsv(picked, names, on));
						setOpen(false);
					}}
				>
					<DialogPanel className="flex flex-col gap-4">
						<div className="flex flex-wrap gap-1.5">
							{FIXED.map((col) => (
								<Badge key={col} size="lg" variant="outline">
									{col}
								</Badge>
							))}
							{/* 主张那几列换个调子：它们是随这次查询变的，前面六列不是。
							    两条主张可以同名（「增长」在职的和入职前的），key 只能是位置。 */}
							{on &&
								names.map((name, i) => (
									<Badge key={String(i)} size="lg" variant="info">
										{name}
									</Badge>
								))}
						</div>
						<Field>
							<FieldLabel>
								<Checkbox
									checked={evidence}
									disabled={names.length === 0}
									onCheckedChange={setEvidence}
								/>
								每条条件一列，写上匹配证据
							</FieldLabel>
							<FieldDescription>
								勾上之后，导出的表里会多出这次查询的每一条条件。
							</FieldDescription>
						</Field>
						{/*
						 * 选中的比够得着的少时，说清这份表里是谁，并给出把人补齐的那一下。
						 *
						 * 名单一页页长出来是名单自己的事，导出的份数不该由用户滚到哪儿
						 * 决定，所以这里不报「还有多少人没加载」，而是把补齐做掉。
						 */}
						{picked.length < reach && (
							<Alert variant="info">
								<InfoIcon />
								<AlertDescription className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
									<span className="min-w-0 flex-1">
										这份表是你选的 {picked.length} 人。符合条件的共 {total} 人
										{total > reach && `，名单按相关度给到前 ${reach} 位`}。
									</span>
									<Button
										className="shrink-0"
										loading={loading}
										onClick={onAll}
										size="xs"
										variant="outline"
									>
										选上这 {reach} 人
									</Button>
								</AlertDescription>
							</Alert>
						)}
					</DialogPanel>
					<DialogFooter>
						<DialogClose render={<Button variant="ghost" />}>取消</DialogClose>
						<Button type="submit">
							<DownloadIcon />
							下载
						</Button>
					</DialogFooter>
				</Form>
			</DialogPopup>
		</Dialog>
	);
}
