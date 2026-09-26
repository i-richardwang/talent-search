import { Search } from "lucide-react";
import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Form } from "#/components/ui/form";
import { Input, InputNumber } from "#/components/ui/input";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

type Layout = "horizontal" | "vertical";
type LayoutChoice = Layout | "auto";

const LAYOUTS: Layout[] = ["horizontal", "vertical"];

/** 等一会儿再结束，让提交按钮的加载态看得见。 */
const wait = () => new Promise<void>((done) => setTimeout(done, 900));

/** 导出设置的两个字段，试用和排法表共用。 */
function ExportFields() {
	return (
		<>
			<Form.Field desc="下载的文件用这个名字。" label="文件名" name="fileName">
				<Input
					defaultValue="数据平台候选人"
					placeholder="例如：数据平台候选人"
				/>
			</Form.Field>
			<Form.Field
				desc="每条搜索条件一列，写上匹配证据。"
				label="附上匹配证据"
				name="evidence"
			>
				<Checkbox />
			</Form.Field>
		</>
	);
}

function Playground() {
	const [layout, setLayout] = useState<LayoutChoice>("auto");
	const [busy, setBusy] = useState(false);
	const [submitted, setSubmitted] = useState<string | null>(null);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="排法">
					<Segmented<LayoutChoice>
						onChange={setLayout}
						options={[
							{ label: "按宽度", value: "auto" },
							{ label: "标签在左", value: "horizontal" },
							{ label: "标签在上", value: "vertical" },
						]}
						value={layout}
					/>
				</Control>
			</Controls>
			<Stage
				className="items-stretch"
				footer={
					<>
						<span className="font-mono">
							{layout === "auto" ? "layout 不传" : `layout="${layout}"`}
						</span>
						<span>{submitted ?? "还没有提交"}</span>
					</>
				}
			>
				<Form
					gap={0}
					layout={layout === "auto" ? undefined : layout}
					onFormSubmit={async (values) => {
						setBusy(true);
						await wait();
						setBusy(false);
						setSubmitted(`已导出：${String(values.fileName ?? "")}`);
					}}
				>
					<ExportFields />
					<div className="flex justify-end">
						<Button htmlType="submit" loading={busy} type="primary">
							导出
						</Button>
					</div>
				</Form>
			</Stage>
		</div>
	);
}

function Layouts() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>排法</TableHead>
						<TableHead>字段</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{LAYOUTS.map((layout) => (
						<TableRow key={layout}>
							<TableCell className="align-top font-mono text-xs">
								{layout}
							</TableCell>
							<TableCell className="min-w-80 align-top">
								<Form gap={0} layout={layout}>
									<ExportFields />
								</Form>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

/** 关键词搜索的查询面：标签在上，一个框一维，提交按钮在下。 */
function KeywordForm() {
	const [busy, setBusy] = useState(false);
	return (
		<Form
			className="w-full"
			gap={0}
			layout="vertical"
			onFormSubmit={async () => {
				setBusy(true);
				await wait();
				setBusy(false);
			}}
		>
			<Form.Field label="经历或技能" name="what">
				<Input placeholder="例如：推荐系统、Go" />
			</Form.Field>
			<Form.Field desc="每项经历分别计算" label="累计年限（至少）">
				<InputNumber min={0.5} placeholder="不限" step={0.5} />
			</Form.Field>
			<div>
				<Button htmlType="submit" icon={Search} loading={busy} type="primary">
					搜索
				</Button>
			</div>
		</Form>
	);
}

function Usage() {
	const [evidence, setEvidence] = useState(false);
	return (
		<ExampleGrid>
			<Example
				description="查询面一维一个字段，标签在上，窄栏里也不换排法。"
				title="关键词搜索"
			>
				<KeywordForm />
			</Example>
			<Example
				description="只有一个开关项时，用一个字段写清勾上之后会发生什么。"
				title="单项设置"
			>
				<Form className="w-full">
					<Form.Field
						desc="勾上之后，导出的表里会多出每一条搜索条件。"
						label="每条条件一列，写上匹配证据"
					>
						<Checkbox checked={evidence} onChange={setEvidence} />
					</Form.Field>
				</Form>
			</Example>
		</ExampleGrid>
	);
}

/** 表单页：试用、排法、使用场景。 */
export function FormPage() {
	return (
		<DocPage
			facts={[`${LAYOUTS.length} 种排法`, "字段用 Form.Field"]}
			rules={{
				notes: [
					"字段用 Form.Field 包住控件，标签和说明写在 label、desc 上，不手写标签行。",
					"输入用 Input / TextArea / InputNumber，图标与提交放进它们的插槽或表单底部。",
					'提交用 onFormSubmit 拿到按 name 收集的字段值，提交按钮是 htmlType="submit" 的 Button。',
					"不传 layout 时窄屏标签在上、宽屏标签在左；窄栏里固定排法才传 layout。",
				],
				usage: `<Form layout="vertical" onFormSubmit={search}>\n  <Form.Field label="经历或技能" name="what">\n    <Input placeholder="例如：推荐系统" />\n  </Form.Field>\n  <Button htmlType="submit" type="primary">搜索</Button>\n</Form>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用表单" },
				{ children: <Layouts />, id: "appearance", title: "排法" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
