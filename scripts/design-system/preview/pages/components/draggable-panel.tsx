import { useState } from "react";
import { NavHeader, NavHeaderTitle } from "#/components/ui/app-layout";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { DraggablePanel } from "#/components/ui/draggable-panel";
import { Segmented } from "#/components/ui/segmented";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

type Placement = "left" | "right";

const MIN = 200;
const MAX = 420;
const DEFAULT = 280;

/** 面板里的一段示例内容：顶上一条页头，下面几行字。 */
function PanelBody({ title, width }: { title: string; width?: number }) {
	return (
		<>
			<NavHeader left={<NavHeaderTitle as="h2">{title}</NavHeaderTitle>} />
			<div className="flex flex-col gap-2 px-4 text-fg-secondary text-sm">
				<p>拖动朝内容那一侧的边调宽，双击复原。</p>
				{width !== undefined && (
					<p className="text-fg-tertiary text-xs tabular-nums">
						当前 {width}px
					</p>
				)}
			</div>
		</>
	);
}

/** 旁边那一栏：面板变宽变窄时它让出或收回宽度。 */
function Main() {
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<NavHeader left={<NavHeaderTitle as="h2">名单</NavHeaderTitle>} />
			<p className="px-4 text-fg-tertiary text-sm">这一栏占剩下的宽。</p>
		</div>
	);
}

function Playground() {
	const [placement, setPlacement] = useState<Placement>("right");
	const [expand, setExpand] = useState(true);
	const [border, setBorder] = useState(true);
	const [wide, setWide] = useState(false);
	const [width, setWidth] = useState(DEFAULT);
	const panel = (
		<DraggablePanel
			className="h-full bg-container"
			defaultSize={DEFAULT}
			expand={expand}
			maxWidth={MAX}
			minWidth={MIN}
			onExpandChange={setExpand}
			onSizeChange={setWidth}
			placement={placement}
			showBorder={border}
			showHandleWideArea={wide}
			size={width}
		>
			<PanelBody title="面板" width={width} />
		</DraggablePanel>
	);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="贴在">
					<Segmented<Placement>
						onChange={setPlacement}
						options={[
							{ label: "左边", value: "left" },
							{ label: "右边", value: "right" },
						]}
						value={placement}
					/>
				</Control>
				<Control>
					<Button onClick={() => setExpand(!expand)} size="small">
						{expand ? "收起" : "展开"}
					</Button>
				</Control>
				<Control>
					<Checkbox checked={border} onChange={setBorder}>
						画出边线
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={wide} onChange={setWide}>
						加宽可拖区域
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				className="items-stretch p-0"
				footer={
					<>
						<span>
							宽 {MIN}–{MAX}px，默认 {DEFAULT}px
						</span>
						<span>可拖区域 {wide ? 16 : 8}px，触屏 20px</span>
						<span>方向键 10px，Shift 50px，回车收起</span>
					</>
				}
			>
				<div className="flex h-80 bg-container">
					{placement === "left" && panel}
					<Main />
					{placement === "right" && panel}
				</div>
			</Stage>
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="工作台的右栏贴在右边，线程和人的详情各记各的宽；边线就是和名单之间的那根竖线。"
				title="右栏"
			>
				<div className="flex h-56 w-full overflow-hidden rounded-md border bg-container">
					<Main />
					<DraggablePanel
						className="h-full"
						defaultSize={160}
						maxWidth={240}
						minWidth={120}
						showHandleWideArea={false}
					>
						<PanelBody title="对话" />
					</DraggablePanel>
				</div>
			</Example>
			<Example
				description="导航栏贴在左边，不画边线，只有拖动的光标；收起时宽度动画到 0。"
				title="导航栏"
			>
				<div className="flex h-56 w-full overflow-hidden rounded-md bg-layout">
					<DraggablePanel
						className="h-full"
						defaultSize={140}
						maxWidth={200}
						minWidth={120}
						placement="left"
						showBorder={false}
					>
						<PanelBody title="导航" />
					</DraggablePanel>
					<div className="m-2 flex-1 rounded-md border bg-container" />
				</div>
			</Example>
		</ExampleGrid>
	);
}

/** 可拖动面板页：试用、产品里的两处用法。 */
export function DraggablePanelPage() {
	return (
		<DocPage
			facts={["拖动调宽", "展开收起", "键盘调宽"]}
			rules={{
				notes: [
					"宽度夹在 minWidth–maxWidth 之间；双击分隔条回到 defaultSize。",
					"给了 size 就受控：拖完一次回调 onSizeChange，要不要记住由调用方定。",
					"expand 为假时宽度动画到 0，内容保持原宽整块滑出，不可交互。",
					"分隔条聚焦后方向键每次 10px、Shift 或 PageUp/PageDown 每次 50px，Home/End 到两头，回车或空格展开收起。",
					"面板的边线由分隔条画：平时 border-secondary、悬停 fill、拖动中主色；showBorder 为假时不画线。",
				],
				usage: `<DraggablePanel\n  defaultSize={400}\n  expand={open}\n  maxWidth={560}\n  minWidth={400}\n  onSizeChange={setWidth}\n  placement="right"\n  showHandleWideArea={false}\n  size={width}\n>\n  {children}\n</DraggablePanel>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用可拖动面板" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
