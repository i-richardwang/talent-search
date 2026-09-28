import { useState } from "react";
import { Checkbox } from "#/components/ui/checkbox";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { px, useMeasured } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

/** 合成的候选人名单，只用来撑出滚动。 */
const PEOPLE = Array.from({ length: 16 }, (_, index) => ({
	id: `Talent ${String(index + 1).padStart(4, "0")}`,
	years: 3 + (index % 7),
}));

const FILTERS = [
	"学历",
	"招聘渠道",
	"经历时长",
	"所在部门",
	"学校",
	"职级",
	"序列",
	"城市",
	"入职年份",
	"技能",
];

function PersonRows() {
	return (
		<ul className="flex flex-col text-sm">
			{PEOPLE.map((person) => (
				<li className="flex justify-between gap-4 px-3 py-2" key={person.id}>
					<span>{person.id}</span>
					<span className="text-fg-tertiary tabular-nums">
						{person.years} 年
					</span>
				</li>
			))}
		</ul>
	);
}

function measureScrollbar(root: HTMLElement) {
	return root
		.querySelector('[data-orientation="vertical"]')
		?.getBoundingClientRect().width;
}

function Playground() {
	const [fade, setFade] = useState(true);
	const { reading: scrollbar, ref } = useMeasured(measureScrollbar);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={fade} onChange={setFade}>
						边缘淡出
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						{scrollbar !== undefined && <span>滚动条 {px(scrollbar)}</span>}
						<span>边缘淡出{fade ? "开" : "关"}</span>
					</>
				}
			>
				<div className="contents" ref={ref}>
					<ScrollArea className="h-60 w-full max-w-xs" scrollFade={fade}>
						<PersonRows />
					</ScrollArea>
				</div>
			</Stage>
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="筛选栏高度随窗口，项多时自己滚；上下淡出提示还有没看到的项。"
				title="侧栏滚动"
			>
				<ScrollArea
					className="h-48 w-full"
					scrollFade
					viewportProps={{
						className: "data-has-overflow-y:overscroll-y-contain",
					}}
				>
					<ul className="flex flex-col gap-2 text-sm">
						{FILTERS.map((filter) => (
							<li className="text-fg-secondary" key={filter}>
								{filter}
							</li>
						))}
					</ul>
				</ScrollArea>
			</Example>
			<Example
				description="内容里有断不开的一行宽文字时，滚动区不被它撑宽。"
				title="不撑宽外层"
			>
				<ScrollArea className="h-40 w-full">
					<pre className="overflow-hidden text-ellipsis p-3 font-mono text-fg-secondary text-xs leading-5">
						{PEOPLE.map(
							(person) =>
								`${person.id}  累计 ${person.years} 年  推荐系统 / 搜索排序 / 特征工程 / 实时计算\n`,
						).join("")}
					</pre>
				</ScrollArea>
			</Example>
		</ExampleGrid>
	);
}

export function ScrollAreaPage() {
	return (
		<DocPage
			facts={["纵向滚动", "上下淡出"]}
			rules={{
				notes: [
					"高度由外层布局给（如 size-full min-h-0），滚动区自己不定高。",
					"内容里有断不开的宽元素时，滚动区不被它撑宽外层。",
					"只有还能滚的一端需要提示时用 scrollFade，不另画渐变遮罩。",
					"只带一根纵向滚动条；视口的类名和 ref 经 viewportProps 交进去。",
				],
				usage: `<ScrollArea className="size-full min-h-0" scrollFade>\n  {children}\n</ScrollArea>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用滚动区" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
