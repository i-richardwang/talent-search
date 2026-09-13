import { DownloadIcon, InfoIcon } from "lucide-react";
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
	Toolbar,
	ToolbarButton,
	ToolbarGroup,
	ToolbarSeparator,
} from "#/components/ui/toolbar";
import { csvName, download, FIXED, toCsv } from "../-lib/csv";
import type { Pick, Picks } from "../-lib/picks";

/** 选择非空时在内容下沿显示批量操作工具栏。 */
export function PickDock({
	picks,
	names,
	total,
}: {
	picks: Picks;
	/** 这次查询各主张的名字，按屏幕上的顺序。导出时一条一列。 */
	names: string[];
	/** 库里符合条件的总人数。名单上这几个人只是其中一段。 */
	total: number;
}) {
	const { clear, picked, shownIds, shownPicked } = picks;
	// 按名次导出，不按点下去的先后：拿到这份表的人读的是名单，不是我的操作顺序。
	const chosen = [...picked.values()].sort((a, b) => a.rank - b.rank);
	if (chosen.length === 0) return null;

	return (
		<div className="pointer-events-none sticky bottom-4 z-stick flex justify-center pt-4">
			{/* 报数一段、动作一段，中间一条 `ToolbarSeparator`——这是 `Toolbar` 自己的
			    分段方式（上游 `p-toolbar-1` 的排法），不是我拿间距凑出来的两堆。
			    浮起来的那层皮沿用 coss 给浮层的那一套（`bg-popover` 配 `shadow-lg/5`），
			    不另配一个更黑的影子：这一屏的层次是靠线和这一档影子分的。 */}
			<Toolbar
				aria-label="已挑上的人"
				className="pointer-events-auto items-center bg-popover shadow-lg/5 transition-[opacity,translate] duration-200 ease-out starting:translate-y-2 starting:opacity-0"
			>
				<span className="px-2.5 text-muted-foreground text-sm" role="status">
					已选 <b className="text-foreground tabular-nums">{chosen.length}</b>{" "}
					人
				</span>
				<ToolbarSeparator orientation="vertical" />
				<ToolbarGroup>
					<ToolbarButton
						onClick={clear}
						render={<Button size="sm" variant="ghost" />}
					>
						清空
					</ToolbarButton>
					<ExportDialog
						picked={chosen}
						partial={
							shownIds.length < total && shownPicked.length === shownIds.length
						}
						names={names}
						total={total}
					/>
				</ToolbarGroup>
			</Toolbar>
		</div>
	);
}

/** 导出当前选择的人员，支持附带命中证据；预览展示实际导出列。 */
function ExportDialog({
	picked,
	names,
	total,
	partial,
}: {
	picked: Pick[];
	names: string[];
	total: number;
	/** 名单上这一批全挑上了，但库里还有没加载出来的人。 */
	partial: boolean;
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
								每条条件一列，写上凭据
							</FieldLabel>
							<FieldDescription>
								勾上之后，上面那排列名里就多出这次查询的每一条条件。
							</FieldDescription>
						</Field>
						{/* 名单只是命中的前几页。不说的话导出的份数会比屏幕上那个总数少，
						    而少了谁没有任何地方交代。 */}
						{partial && (
							<Alert variant="info">
								<InfoIcon />
								<AlertDescription>
									这是符合条件的前 {picked.length} 位。库里还有{" "}
									{total - picked.length} 人没加载出来，不在这份表里。
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
