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

/**
 * 挑上人之后浮在名单下沿的那一小块：挑了几个、清空、导出。一个人都没挑的时候
 * 它不在（为什么浮在下沿、为什么空着不摆，见 AGENTS.md）。
 *
 * `sticky` 不是 `fixed`：它住在名单这一栏里，所以左右和名单对齐，滚到底就落回
 * 名单尽头，不会永远糊在屏幕上挡住最后一块。
 *
 * 这里**只报数、只给动作**，不列挑了谁：挑了谁名单上那几个打上勾的块自己在说。
 */
export function PickDock({
	picks,
	terms,
	total,
}: {
	picks: Picks;
	/** 这次查询的条件词，按屏幕上的顺序。导出时一条一列。 */
	terms: string[];
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
						terms={terms}
						total={total}
					/>
				</ToolbarGroup>
			</Toolbar>
		</div>
	);
}

/**
 * 导出的设置。**只剩一个决定**：要不要把命中证据也带上。
 *
 * 「导出谁」不问了——挑上的就是要导的，名单上打了勾的那几块已经把这件事说完；
 * 再在这一层复述一遍范围，等于让人把刚做完的事重做一次，而两处不一致时还得
 * 自己判断哪一处算数。要整份名单，勾表头那个全选就是。
 *
 * 格式不给选（`csv.ts` 开头写了为什么只有 CSV），文件名不给填——一个默认值就
 * 对的东西做成输入框，是把一次点击换成一次填空。
 *
 * 那个勾**改的是上面那排列名**，不是一句描述：一份表长什么样，写出列名比写
 * 「包含命中证据」这句话准确得多，而这也正是打开文件之后第一行会看到的东西。
 */
function ExportDialog({
	picked,
	terms,
	total,
	partial,
}: {
	picked: Pick[];
	terms: string[];
	total: number;
	/** 名单上这一批全挑上了，但库里还有没加载出来的人。 */
	partial: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [evidence, setEvidence] = useState(true);
	const on = evidence && terms.length > 0;

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
						download(csvName(), toCsv(picked, terms, on));
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
							{/* 条件词那几列换个调子：它们是随这次查询变的，前面六列不是。 */}
							{on &&
								terms.map((term) => (
									<Badge key={term} size="lg" variant="info">
										{term}
									</Badge>
								))}
						</div>
						<Field>
							<FieldLabel>
								<Checkbox
									checked={evidence}
									disabled={terms.length === 0}
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
