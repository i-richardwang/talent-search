import { PencilLineIcon, Redo2Icon, SaveIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Divider } from "#/components/ui/divider";
import { Segmented } from "#/components/ui/segmented";
import { Tag } from "#/components/ui/tag";
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
	const [dashed, setDashed] = useState(false);
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
				<Control>
					<Checkbox checked={dashed} onChange={setDashed}>
						虚线
					</Checkbox>
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
							<Divider dashed={dashed} />
							<p className="text-fg-secondary">任职经历 3 段</p>
						</div>
					) : (
						<div className="flex items-center text-sm">
							<span>AI 搜索</span>
							<Divider dashed={dashed} orientation="vertical" />
							<span>关键词搜索</span>
							<Divider dashed={dashed} orientation="vertical" />
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
				description="线的正中放一枚标签，记一件不是谁说的话的事：对话线程里直接改了搜索条件的那一次，上下各留 20px。"
				title="线中间的事件"
			>
				<div className="w-full text-sm">
					<p className="text-fg-secondary">已添加 团队管理（加分）</p>
					<Divider className="my-0 py-5">
						<Tag icon={PencilLineIcon}>
							你修改了搜索条件：移除 学历 · 硕士及以上
						</Tag>
					</Divider>
					<p className="text-fg-secondary">再看看做过搜索排序的</p>
				</div>
			</Example>
			<Example
				description="一段内容的收尾用虚线，和下一段隔开但不像换了一块：对话线程里检索过程的一步点开后，结论底下一条虚线，上边距收成 8px、下边距收成 0。"
				title="一段结论的收尾"
			>
				<div className="w-full text-fg-tertiary text-xs">
					<p>「搜索排序」，128 人</p>
					<p className="mt-2">「推荐系统」匹配到「推荐算法」，96 人</p>
					<Divider className="mt-2 mb-0" dashed />
				</div>
			</Example>
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
			facts={[`${ORIENTATIONS.length} 个方向`, "实线与虚线", "线中间可放内容"]}
			rules={{
				notes: [
					"只分隔同一块面里的两段内容；两块不同的面用 Block 分开，不用线。",
					"横线的上下外边距由组件给；只有贴着一段内容收尾或给线中间的事件留白时，调用处才改上下边距。",
					"dashed 画成虚线，用在一段内容的收尾；分隔两段并列的内容用实线。",
					"竖线放在一行 flex 里，窄屏换行时用外层的响应式类把它藏起来。",
					"线的颜色来自 --color-split，不覆盖。",
					"横线正中可以放内容（children），这时它不是分隔符，内容照常读出。",
				],
				usage: `<Divider />\n<Divider dashed />\n<Divider orientation="vertical" />\n<Divider><Tag>…</Tag></Divider>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用分割线" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
