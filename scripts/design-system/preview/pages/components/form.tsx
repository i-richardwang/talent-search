import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Form } from "#/components/ui/form";
import { Input } from "#/components/ui/input";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

/** 等一会儿再结束，让提交按钮的加载态看得见。 */
const wait = () => new Promise<void>((done) => setTimeout(done, 900));

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
	const [busy, setBusy] = useState(false);
	const [submitted, setSubmitted] = useState<string | null>(null);
	return (
		<div className="flex flex-col gap-4">
			<Stage
				className="items-stretch"
				footer={
					<>
						<span>窄屏标签在上、宽屏标签在左</span>
						<span>{submitted ?? "还没有提交"}</span>
					</>
				}
			>
				<Form
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

function Usage() {
	const [evidence, setEvidence] = useState(false);
	return (
		<ExampleGrid>
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

export function FormPage() {
	return (
		<DocPage
			facts={["按宽度排", "字段用 Form.Field"]}
			rules={{
				notes: [
					"字段用 Form.Field 包住控件，标签和说明写在 label、desc 上，不手写标签行。",
					"输入用 Input，图标与提交放进它的插槽或表单底部。",
					'提交用 onFormSubmit 拿到按 name 收集的字段值，提交按钮是 htmlType="submit" 的 Button。',
					"窄屏标签在上、宽屏标签在左，排法不由调用处选。",
				],
				usage: `<Form>\n  <Form.Field desc="勾上之后，导出的表里会多出每一条搜索条件。" label="每条条件一列，写上匹配证据">\n    <Checkbox checked={evidence} onChange={setEvidence} />\n  </Form.Field>\n</Form>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用表单" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
