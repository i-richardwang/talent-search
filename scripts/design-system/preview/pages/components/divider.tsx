import { Redo2Icon, SaveIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Button } from "#/components/ui/button";
import { Divider } from "#/components/ui/divider";
import { Segmented } from "#/components/ui/segmented";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { px, useMeasured } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

type Orientation = "horizontal" | "vertical";

const ORIENTATIONS: { label: string; value: Orientation }[] = [
	{ label: "横向", value: "horizontal" },
	{ label: "竖向", value: "vertical" },
];

/** 量第一条分隔线：线外的边距、线宽，以及竖线的高。 */
function measureLine(root: HTMLElement) {
	const line = root.querySelector('[role="separator"]');
	if (!line) return undefined;
	const style = getComputedStyle(line);
	const vertical = line.getAttribute("aria-orientation") === "vertical";
	const rect = line.getBoundingClientRect();
	return {
		length: rect.height,
		line: Number.parseFloat(
			vertical ? style.borderInlineStartWidth : style.borderBlockStartWidth,
		),
		margin: Number.parseFloat(vertical ? style.marginLeft : style.marginTop),
	};
}

function Playground() {
	const [orientation, setOrientation] = useState<Orientation>("horizontal");
	const { reading, ref } = useMeasured(measureLine);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="方向">
					<Segmented<Orientation>
						onChange={setOrientation}
						options={ORIENTATIONS}
						value={orientation}
					/>
				</Control>
			</Controls>
			<Stage
				footer={
					reading &&
					(orientation === "horizontal" ? (
						<>
							<span>上下外边距 {px(reading.margin)}</span>
							<span>线宽 {px(reading.line)}</span>
						</>
					) : (
						<>
							<span>左右外边距 {px(reading.margin)}</span>
							<span>高 {px(reading.length)}</span>
						</>
					))
				}
			>
				<div className="contents" ref={ref}>
					{orientation === "horizontal" ? (
						<div className="w-full max-w-md text-sm">
							<p>候选人 A · 数据平台</p>
							<Divider />
							<p className="text-fg-secondary">任职经历 3 段</p>
						</div>
					) : (
						<div className="flex items-center text-sm">
							<span>AI 搜索</span>
							<Divider orientation="vertical" />
							<span>关键词搜索</span>
							<Divider orientation="vertical" />
							<span>技能</span>
						</div>
					)}
				</div>
			</Stage>
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="一行里两组不同的事用一条竖线分开：设计系统的顶栏里，撤销重做是一组，保存导出是另一组。"
				title="一行里的两组动作"
			>
				<div className="flex items-center gap-2">
					<ActionIcon icon={Undo2Icon} title="撤销" />
					<ActionIcon icon={Redo2Icon} title="重做" />
					<Divider orientation="vertical" />
					<Button icon={SaveIcon}>保存方案</Button>
				</div>
			</Example>
		</ExampleGrid>
	);
}

/** 分割线页：方向的试用、产品里的几处用法。 */
export function DividerPage() {
	return (
		<DocPage
			facts={[`${ORIENTATIONS.length} 个方向`]}
			rules={{
				notes: [
					"只分隔同一块面里的两段内容；两块不同的面用 Block 分开，不用线。",
					"横线的上下外边距由组件给，调用处不给线加 margin 或 padding。",
					"竖线放在一行 flex 里，窄屏换行时用外层的响应式类把它藏起来。",
					"线的颜色来自 --color-split，不覆盖。",
				],
				usage: `<Divider />\n<Divider orientation="vertical" />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用分割线" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
