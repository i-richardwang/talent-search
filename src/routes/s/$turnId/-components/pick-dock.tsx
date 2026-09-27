import { DownloadIcon, ListIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Form } from "#/components/ui/form";
import { List, ListItem } from "#/components/ui/list";
import { Modal } from "#/components/ui/modal";
import { Popover } from "#/components/ui/popover";
import { Tag } from "#/components/ui/tag";
import { Text } from "#/components/ui/text";
import { toast } from "#/components/ui/toast";
import {
	Toolbar,
	ToolbarButton,
	ToolbarSeparator,
} from "#/components/ui/toolbar";
import { csvName, download, FIXED, toCsv } from "../-lib/csv";
import type { Pick, Picks } from "../-lib/picks";
import { reachOf } from "../-lib/view-params";

/**
 * 选中人之后浮现的工具条：选了几个，以及对这一批做什么。吸在名单那一栏下沿往上 24px，
 * 边往下看边选时就在视线里；一个人都没选时不渲染。人数是一行 500 字重的字，动作是一排
 * 小号图标钮（看已选的人、导出），分隔线后面是清空。
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
	/** 把显示上限内的人全部选中：名单没加载完的部分一并加载出来。 */
	onAll: () => void;
	/** 那一步正在跑，按钮据此转圈。 */
	loading: boolean;
}) {
	const { clear, picked, remove, shownIds } = picks;
	// 按名次排，不按点选先后：清单和导出的表同序，核对时一行对一行。
	const chosen = [...picked.values()].sort((a, b) => a.rank - b.rank);
	if (chosen.length === 0) return null;

	return (
		/* 通栏这一层不接鼠标，只有工具栏自己接，不挡住它下面的名单行。 */
		<div className="pointer-events-none sticky bottom-6 z-stick flex justify-center pt-6">
			<Toolbar
				aria-label="已选择的人"
				className="pointer-events-auto transition-[opacity,translate] duration-200 ease-out starting:translate-y-2 starting:opacity-0"
			>
				{/* 数字变化要播报 */}
				<Text aria-live="polite" className="me-2" weight="medium">
					已选 <span className="tabular-nums">{chosen.length}</span> 人
				</Text>
				<Chosen chosen={chosen} onList={new Set(shownIds)} onRemove={remove} />
				<ExportDialog
					loading={loading}
					names={names}
					onAll={onAll}
					picked={chosen}
					reach={reachOf(total)}
					total={total}
				/>
				<ToolbarSeparator />
				<ToolbarButton
					onClick={clear}
					render={
						<ActionIcon
							icon={XIcon}
							size="small"
							title="清空已选"
							tooltipProps={{ hotkey: "esc" }}
						/>
					}
				/>
			</Toolbar>
		</div>
	);
}

/**
 * 看已选的人：点开按名次列出选中的人，每行只写姓名、可以移除。改过筛选后不在
 * 名单上的已选人会标出来，也只能在这里移除（快照见 `-lib/picks.ts` 的 `Pick`）。
 */
function Chosen({
	chosen,
	onList,
	onRemove,
}: {
	chosen: Pick[];
	/** 此刻名单上有哪些人；不在里面的已选人标「不在名单上」。 */
	onList: ReadonlySet<string>;
	onRemove: (empId: string) => void;
}) {
	return (
		<Popover
			className="max-h-(--available-height) w-64 overflow-y-auto"
			content={
				<>
					<Text as="div" className="px-1" weight="medium">
						已选的人
					</Text>
					{/* 浮层高度到屏幕边为止（`--available-height`），超出在里面滚动 */}
					<List className="-mx-1">
						{chosen.map((one) => (
							<ListItem
								actions={
									<ActionIcon
										aria-label={`移除 ${one.name}`}
										icon={XIcon}
										onClick={() => onRemove(one.empId)}
										size="small"
									/>
								}
								description={onList.has(one.empId) ? undefined : "不在名单上"}
								key={one.empId}
								showAction
								title={one.name}
							/>
						))}
					</List>
				</>
			}
			nativeButton
			placement="top"
			popupProps={{ "aria-label": "已选的人" }}
			trigger="click"
		>
			<ToolbarButton
				render={<ActionIcon icon={ListIcon} size="small" title="已选的人" />}
			/>
		</Popover>
	);
}

/**
 * 导出成一份 CSV。先弹一个对话框：列出表格的列，决定要不要带上匹配证据，并说清
 * 这份表里是不是符合条件的全部人。
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
	/** 这次查询能显示的人有几个（`reachOf`）。 */
	reach: number;
	onAll: () => void;
	loading: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [evidence, setEvidence] = useState(true);
	const on = evidence && names.length > 0;

	return (
		<>
			<ToolbarButton
				onClick={() => setOpen(true)}
				render={
					<ActionIcon
						icon={DownloadIcon}
						size="small"
						title={`导出 ${picked.length} 人`}
					/>
				}
			/>
			<Modal
				className="max-w-md"
				okIcon={DownloadIcon}
				okText="下载"
				onCancel={() => setOpen(false)}
				onOk={() => {
					try {
						download(csvName(), toCsv(picked, names, on));
					} catch {
						toast.error("没能导出名单，请重试。");
						return;
					}
					setOpen(false);
					toast.success(`已导出 ${picked.length} 人的名单`);
				}}
				open={open}
				title={`导出这 ${picked.length} 人`}
			>
				<div className="flex flex-col gap-4">
					<p className="text-fg-secondary">
						一份 CSV，Excel 和飞书表格都打得开。
					</p>
					<div className="flex flex-wrap gap-1.5">
						{FIXED.map((col) => (
							<Tag key={col} variant="outlined">
								{col}
							</Tag>
						))}
						{/* 两条主张可以同名，key 用位置 */}
						{on && names.map((name, i) => <Tag key={String(i)}>{name}</Tag>)}
					</div>
					<Form>
						<Form.Field
							desc="勾上之后，导出的表里会多出这次查询的每一条条件。"
							label="每条条件一列，写上匹配证据"
						>
							<Checkbox
								checked={evidence}
								disabled={names.length === 0}
								onChange={setEvidence}
							/>
						</Form.Field>
					</Form>
					{/* 选中的比能显示的少时，说清这份表里是谁，并给出补齐的一下 */}
					{picked.length < reach && (
						<Alert
							action={
								<Button loading={loading} onClick={onAll} size="small">
									选择全部 {reach} 人
								</Button>
							}
							title={
								<>
									这份表是你选择的 {picked.length} 人。符合条件的共 {total} 人
									{total > reach && `，仅显示匹配度最高的 ${reach} 人`}。
								</>
							}
							type="info"
						/>
					)}
				</div>
			</Modal>
		</>
	);
}
