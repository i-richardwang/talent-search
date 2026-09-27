import { Download } from "lucide-react";
import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
	Toolbar,
	ToolbarButton,
	ToolbarSeparator,
} from "#/components/ui/toolbar";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

/** 合成的候选人，勾选示例用。 */
const CANDIDATES = [
	{ id: "Talent 0101", summary: "推荐系统 · 累计 6 年" },
	{ id: "Talent 0214", summary: "搜索排序 · 累计 4 年" },
	{ id: "Talent 0357", summary: "特征工程 · 累计 8 年" },
	{ id: "Talent 0480", summary: "实时计算 · 累计 3 年" },
];

/** 工具条的长相：浮起的胶囊，计数一段、操作一段，中间一条分隔线。 */
function Appearance() {
	return (
		<Stage footer={<span>左右方向键在按钮间移动</span>}>
			<Toolbar aria-label="已选择的人">
				<ToolbarButton
					render={
						<Button className="text-fg-secondary" size="small" type="text" />
					}
				>
					已选 <b className="text-fg tabular-nums">3</b> 人
				</ToolbarButton>
				<ToolbarSeparator />
				<ToolbarButton render={<Button size="small" type="text" />}>
					清空
				</ToolbarButton>
				<ToolbarButton
					render={<Button icon={Download} size="small" type="primary" />}
				>
					导出 3 人
				</ToolbarButton>
			</Toolbar>
		</Stage>
	);
}

/** 勾选候选人后在名单下方出现的批量操作栏；一个都没选时不渲染。 */
function PickDockExample() {
	const [picked, setPicked] = useState<string[]>(["Talent 0101"]);
	const toggle = (id: string, checked: boolean) =>
		setPicked((current) =>
			checked ? [...current, id] : current.filter((one) => one !== id),
		);
	return (
		<div className="flex w-full flex-col gap-3">
			<Block gap={0} variant="outlined">
				{CANDIDATES.map((candidate) => (
					<div className="flex items-center gap-3 px-3 py-2" key={candidate.id}>
						<Checkbox
							checked={picked.includes(candidate.id)}
							onChange={(checked) => toggle(candidate.id, checked)}
						>
							<span className="text-sm">{candidate.id}</span>
						</Checkbox>
						<span className="ml-auto text-fg-tertiary text-xs">
							{candidate.summary}
						</span>
					</div>
				))}
			</Block>
			<div className="flex h-10 justify-center">
				{picked.length > 0 && (
					<Toolbar
						aria-label="已选择的人"
						className="transition-[opacity,translate] duration-200 ease-out starting:translate-y-2 starting:opacity-0"
					>
						<ToolbarButton
							render={
								<Button
									aria-live="polite"
									className="text-fg-secondary"
									size="small"
									type="text"
								/>
							}
						>
							已选 <b className="text-fg tabular-nums">{picked.length}</b> 人
						</ToolbarButton>
						<ToolbarSeparator />
						<ToolbarButton
							onClick={() => setPicked([])}
							render={<Button size="small" type="text" />}
						>
							清空
						</ToolbarButton>
						<ToolbarButton
							render={<Button icon={Download} size="small" type="primary" />}
						>
							导出 {picked.length} 人
						</ToolbarButton>
					</Toolbar>
				)}
			</div>
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="批量操作只在选择非空时出现：先勾候选人，工具条带着人数、清空和导出浮上来；清空后收起。"
				title="勾选后批量操作"
			>
				<PickDockExample />
			</Example>
		</ExampleGrid>
	);
}

/** 工具条页：外观、勾选候选人后的批量操作。 */
export function ToolbarPage() {
	return (
		<DocPage
			facts={["横排", "分隔线"]}
			rules={{
				notes: [
					"批量操作用选择非空时出现的 Toolbar，选择清空时整栏收起，不留一栏禁用的按钮。",
					"按钮经 ToolbarButton 的 render 交进来，左右方向键在它们之间移动焦点。",
					"整栏写 aria-label 说明它操作的是什么。",
					"分组用 ToolbarSeparator，不另放 Divider。",
					"胶囊的描边、底色与投影是工具条自带的，位置由外层布局给。",
				],
				usage: `<Toolbar aria-label="已选择的人">\n  <ToolbarButton render={<Button size="small" type="text" />}>清空</ToolbarButton>\n  <ToolbarSeparator />\n  <ToolbarButton render={<Button icon={Download} size="small" type="primary" />}>\n    导出 3 人\n  </ToolbarButton>\n</Toolbar>`,
			}}
			sections={[
				{ children: <Appearance />, id: "appearance", title: "外观" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
