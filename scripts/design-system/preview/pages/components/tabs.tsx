import { useState } from "react";
import { Tabs } from "#/components/ui/tabs";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

const ITEMS = [
	{ key: "experience", label: "经历" },
	{ key: "evidence", label: "证据" },
	{ key: "raw", label: "简历原文" },
];

const PANEL_TEXT: Record<string, string> = {
	evidence: "登记证据 2 条，简历自述 3 条，命中「数据平台」「团队管理」。",
	experience: "2019 – 至今 · 数据平台研发，负责离线计算与调度。",
	raw: "这一段还没读过，显示简历里的整段原文。",
};

function Playground() {
	const [active, setActive] = useState("experience");
	return (
		<Stage
			className="items-stretch justify-start"
			footer={<span>选中 {active}</span>}
		>
			<div className="flex flex-col gap-3">
				<Tabs activeKey={active} items={ITEMS} onChange={setActive} />
				<p className="text-fg-secondary text-sm leading-6">
					{PANEL_TEXT[active]}
				</p>
			</div>
		</Stage>
	);
}

function Usage() {
	const [tab, setTab] = useState("design");
	return (
		<ExampleGrid>
			<Example
				description="栏头上切换同一栏的几块内容，内容由栏自己按 activeKey 画；选中项下方一个圆点，贴着栏头不显重。"
				title="栏头上的分区"
			>
				<Tabs
					activeKey={tab}
					items={[
						{ key: "design", label: "设计" },
						{ key: "changes", label: "修改" },
					]}
					onChange={setTab}
				/>
			</Example>
		</ExampleGrid>
	);
}

export function TabsPage() {
	return (
		<DocPage
			facts={["选中项下方一个圆点", "只切换，不带面板"]}
			rules={{
				notes: [
					"同一栏的几块内容用 Tabs 切换；单选取值用 Radio，筛选里的档位用 Segmented。",
					"Tabs 只画一排标签，内容由调用处按 activeKey 渲染。",
					"选中态由圆点和字色表达，不另加底色、边框之类的选中装饰。",
					"不覆盖高度、圆角和内边距；宽度属于外层布局。",
				],
				usage: `<Tabs\n  activeKey={tab}\n  items={[\n    { key: "design", label: "设计" },\n    { key: "changes", label: "修改" },\n  ]}\n  onChange={setTab}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用选项卡" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
