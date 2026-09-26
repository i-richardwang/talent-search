import { useId, useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

const SCHOOLS = ["学校 A", "学校 B", "学校 C", "学校 D", "学校 E", "学校 F"];

const STEPS = [
	"查词：推荐系统 → 标准词 1 个",
	"试搜：推荐系统，累计 5 年以上 → 42 人",
	"试搜：加上搜索排序 → 17 人",
	"交出搜索条件",
];

function Playground() {
	const panelId = useId();
	const [open, setOpen] = useState(true);
	return (
		<Stage className="justify-start" footer={<span>收起时卸载</span>}>
			<div className="w-full max-w-md">
				<CollapsibleTrigger
					className="w-full text-sm"
					onOpenChange={setOpen}
					open={open}
					panelId={panelId}
				>
					这一轮的说明
				</CollapsibleTrigger>
				<Collapsible id={panelId} open={open}>
					<p className="pt-2 text-fg-secondary">
						按「累计 5
						年以上」理解年限，不是单段。人才库里没有「带过团队」这一项，这条没有写进搜索条件。
					</p>
				</Collapsible>
			</div>
		</Stage>
	);
}

/** 筛选栏里一维的前几项常显，其余收进面板，开关写出还有几项。 */
function RestOfFacet() {
	const restId = useId();
	const [all, setAll] = useState(false);
	const row = (school: string) => (
		<Checkbox key={school}>
			<span className="text-sm">{school}</span>
		</Checkbox>
	);
	return (
		<div className="flex w-full flex-col items-start gap-2">
			{SCHOOLS.slice(0, 3).map(row)}
			<Collapsible id={restId} open={all}>
				<div className="flex flex-col gap-2">{SCHOOLS.slice(3).map(row)}</div>
			</Collapsible>
			<CollapsibleTrigger
				className="w-full text-fg-secondary text-sm"
				onOpenChange={setAll}
				open={all}
				panelId={restId}
			>
				{all ? "收起" : `更多 ${SCHOOLS.length - 3} 项`}
			</CollapsibleTrigger>
		</div>
	);
}

/** AI 查词、试搜的每一步收在一行摘要下面。 */
function StepTrace() {
	const panelId = useId();
	const [open, setOpen] = useState(false);
	return (
		<div className="flex w-full flex-col items-start gap-1">
			<CollapsibleTrigger
				className="w-fit text-fg-secondary text-sm"
				onOpenChange={setOpen}
				open={open}
				panelId={panelId}
			>
				AI 查了 {STEPS.length} 步
			</CollapsibleTrigger>
			<Collapsible id={panelId} open={open}>
				<Block
					as="ol"
					className="text-fg-secondary text-xs tabular-nums"
					gap={4}
					padding={12}
					variant="filled"
				>
					{STEPS.map((step) => (
						<li key={step}>{step}</li>
					))}
				</Block>
			</Collapsible>
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="项多的一维只露前几项，其余收起；开关说出还有几项，展开后换成收起。"
				title="筛选项展开其余"
			>
				<RestOfFacet />
			</Example>
			<Example
				description="过程细节默认收起，摘要一行说结论，想核对的人再展开。"
				title="收起过程"
			>
				<StepTrace />
			</Example>
		</ExampleGrid>
	);
}

/** 折叠面板页：开关与面板的试用、产品里的两处用法。 */
export function CollapsiblePage() {
	return (
		<DocPage
			facts={["受控开关", "开关带箭头", "收起时卸载"]}
			rules={{
				notes: [
					"开关用 CollapsibleTrigger：一行内容加一个箭头，aria-expanded 与指向面板的 aria-controls 由它写；它和面板靠同一个 panelId 配对，不必相邻。",
					"open 是受控的，状态放在所属的 hook 或组件里。",
					"收起时内容卸载，里面不放要保住的输入状态。",
					"高度和淡入的过渡由组件给，不另加动效。",
				],
				usage: `<CollapsibleTrigger onOpenChange={setOpen} open={open} panelId={id}>\n  更多 3 项\n</CollapsibleTrigger>\n<Collapsible id={id} open={open}>\n  {rest}\n</Collapsible>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用折叠面板" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
