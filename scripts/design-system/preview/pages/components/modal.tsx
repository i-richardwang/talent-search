import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import {
	Modal,
	ModalBackdrop,
	ModalClose,
	ModalContent,
	ModalPopup,
	ModalPortal,
	ModalRoot,
	ModalTitle,
} from "#/components/ui/modal";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Tag } from "#/components/ui/tag";
import { Control, Controls } from "../../kit/controls";
import { OverlayRow } from "../../kit/overlay-row";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { useMotionCommands } from "../../motion";
import { useTokenNumber } from "../../state";

type Footer = "default" | "none";

const FOOTERS: { label: string; value: Footer }[] = [
	{ label: "取消 / 确定", value: "default" },
	{ label: "不要", value: "none" },
];
/** 宽度由面板的类名给，取容器宽度的档；默认不给。 */
type Width = "default" | "max-w-md" | "max-w-2xl";

const WIDTHS: { label: string; value: Width }[] = [
	{ label: "默认", value: "default" },
	{ label: "md", value: "max-w-md" },
	{ label: "2xl", value: "max-w-2xl" },
];

/** 对话框正文的一段合成说明。 */
const EXPORT_NOTE =
	"导出的名单包含当前搜索条件下的全部候选人，每位一行，附上命中的证据。";

/** 同步任务的合成日志行。 */
const LOG_LINES = [
	"读取数据源：1,204 份简历",
	"拒绝 3 条记录：日期倒置 2 条，缺开始日期 1 条",
	"写入人才库：新增 18 段经历，删除 4 段",
	"同步完成，用时 42 秒",
];

/** 试用：外壳工具条的打开、关闭、重播作用在这里的对话框上。 */
function Playground() {
	const read = useTokenNumber();
	const [open, setOpen] = useState(false);
	const afterClose = useMotionCommands(open, setOpen);
	const duration = (phase: "enter" | "exit") =>
		read(`--duration-modal-${phase}`);
	const [title, setTitle] = useState("导出名单");
	const [footer, setFooter] = useState<Footer>("default");
	const [width, setWidth] = useState<Width>("default");
	const [loading, setLoading] = useState(false);
	const close = () => setOpen(false);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control className="grow" htmlFor="playground-modal-title" label="标题">
					<Input
						id="playground-modal-title"
						onChange={(event) => setTitle(event.target.value)}
						value={title}
					/>
				</Control>
				<Control label="表脚">
					<Segmented<Footer>
						onChange={setFooter}
						options={FOOTERS}
						value={footer}
					/>
				</Control>
				<Control label="宽度">
					<Segmented<Width>
						onChange={setWidth}
						options={WIDTHS}
						value={width}
					/>
				</Control>
				<Control>
					<Checkbox checked={loading} onChange={setLoading}>
						正文等待
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						<span>进场 {duration("enter")} ms</span>
						<span>退场 {duration("exit")} ms</span>
					</>
				}
			>
				<Button onClick={() => setOpen(true)} type="primary">
					打开对话框
				</Button>
				<Modal
					afterClose={afterClose}
					noFooter={footer === "none"}
					loading={loading}
					okText="导出"
					onCancel={close}
					onOk={close}
					open={open}
					title={title}
					className={width === "default" ? undefined : width}
				>
					<p className="text-fg-secondary text-sm leading-6">{EXPORT_NOTE}</p>
				</Modal>
			</Stage>
		</div>
	);
}

function States() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>写法</TableHead>
						<TableHead>形态</TableHead>
						<TableHead>示例</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<OverlayRow
						code="noFooter 不给"
						label="取消 / 确定"
						render={(open, close) => (
							<Modal onCancel={close} onOk={close} open={open} title="导出名单">
								<p className="text-fg-secondary text-sm leading-6">
									{EXPORT_NOTE}
								</p>
							</Modal>
						)}
					/>
					<OverlayRow
						code="okText · okIcon"
						label="确定钮写动作、带图标"
						render={(open, close) => (
							<Modal
								okIcon={DownloadIcon}
								okText="下载"
								onCancel={close}
								onOk={close}
								open={open}
								title="导出这 24 人"
							>
								<p className="text-fg-secondary text-sm leading-6">
									{EXPORT_NOTE}
								</p>
							</Modal>
						)}
					/>
					<OverlayRow
						code="loading"
						label="正文等待"
						render={(open, close) => (
							<Modal
								noFooter
								loading
								onCancel={close}
								open={open}
								title="运行日志"
							>
								{null}
							</Modal>
						)}
					/>
					<OverlayRow
						code="noFooter"
						label="没有表脚"
						render={(open, close) => (
							<Modal noFooter onCancel={close} open={open} title="搜索条件">
								<p className="text-fg-secondary text-sm leading-6">
									做过搜索推荐相关的后端开发，累计 3 年以上，本科及以上。
								</p>
							</Modal>
						)}
					/>
					<OverlayRow
						code="ModalRoot …"
						label="原子件拼：标题只给读屏，正文不带内边距"
						render={(open, close) => (
							<ModalRoot
								onOpenChange={(next) => {
									if (!next) close();
								}}
								open={open}
							>
								<ModalPortal>
									<ModalBackdrop />
									<ModalPopup panelClassName="max-w-2xl">
										<ModalTitle className="sr-only">候选人详情</ModalTitle>
										<ModalContent flush>
											<div className="flex flex-col gap-2 p-6 text-sm">
												<span className="font-medium text-base">候选人 A</span>
												<span className="text-fg-secondary">
													后端开发 · 2022-03 至今
												</span>
											</div>
										</ModalContent>
										<ModalClose />
									</ModalPopup>
								</ModalPortal>
							</ModalRoot>
						)}
					/>
				</TableBody>
			</Table>
		</Block>
	);
}

/** 导出名单：列出表里会有的列，确定钮写「下载」。 */
function ExportList() {
	const [open, setOpen] = useState(false);
	const [done, setDone] = useState(false);
	return (
		<>
			<Button onClick={() => setOpen(true)}>导出 24 人</Button>
			{done && <span className="text-fg-tertiary text-xs">已下载</span>}
			<Modal
				className="max-w-md"
				okIcon={DownloadIcon}
				okText="下载"
				onCancel={() => setOpen(false)}
				onOk={() => {
					setDone(true);
					setOpen(false);
				}}
				open={open}
				title="导出这 24 人"
			>
				<div className="flex flex-col gap-4">
					<p className="text-fg-secondary">
						一份 CSV，Excel 和飞书表格都打得开。
					</p>
					<div className="flex flex-wrap gap-1.5">
						{["当前岗位", "部门", "职级档", "学历"].map((col) => (
							<Tag key={col} variant="outlined">
								{col}
							</Tag>
						))}
					</div>
				</div>
			</Modal>
		</>
	);
}

/** 运行日志：打开时才取，取到之前正文等待。 */
function TaskLog() {
	const [open, setOpen] = useState(false);
	const [lines, setLines] = useState<string[] | null>(null);
	useEffect(() => {
		if (!open) return;
		setLines(null);
		const timer = window.setTimeout(() => setLines(LOG_LINES), 800);
		return () => window.clearTimeout(timer);
	}, [open]);
	return (
		<>
			<Button onClick={() => setOpen(true)} size="small" type="text">
				日志
			</Button>
			<span className="text-fg-tertiary text-xs">同步 · 今天 09:30</span>
			<Modal
				className="max-w-3xl"
				loading={lines === null}
				noFooter
				onCancel={() => setOpen(false)}
				open={open}
				title="运行日志 · 同步 · 今天 09:30 开始"
			>
				<pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
					{lines?.join("\n")}
				</pre>
			</Modal>
		</>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="导出前说清表里有什么；确定钮的文字写动作本身。"
				title="导出名单"
			>
				<ExportList />
			</Example>
			<Example
				description="任务的原始输出不做页面内容，按次收在「日志」里，打开才取；取到之前正文等待。"
				title="运行日志"
			>
				<TaskLog />
			</Example>
		</ExampleGrid>
	);
}

/** 对话框页：试用、表脚与状态、使用场景。外壳工具条可以放试用里对话框的进出场。 */
export function ModalPage() {
	return (
		<DocPage
			facts={[`${FOOTERS.length} 种表脚`, "正文等待", "可用原子件拼"]}
			rules={{
				notes: [
					"对话框挂在打开它的组件里，用受控的 open；关掉走 onCancel，确定后由调用处关。",
					"只用来打断需要确认或补一项输入的动作；一次阅读用 Drawer。",
					"确定钮的文字写动作本身（okText），需要时用 okIcon 加图标。",
					"正文里的控件用 components/ui 的组件，宽度用 className 给容器宽度的档（max-w-md 之类）；正文要贴边用 ModalContent 的 flush，不覆盖面板的圆角和内边距。",
				],
				usage: `<Modal\n  okText="导出"\n  onCancel={() => setOpen(false)}\n  onOk={exportList}\n  open={open}\n  title="导出名单"\n>\n  …\n</Modal>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用对话框" },
				{ children: <States />, id: "appearance", title: "外观与状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
