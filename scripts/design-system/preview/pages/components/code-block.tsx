import { useState } from "react";
import { Alert } from "#/components/ui/alert";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { CodeBlock } from "#/components/ui/code-block";
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

type Variant = "filled" | "outlined" | "borderless";

const VARIANTS: Variant[] = ["filled", "outlined", "borderless"];

/** 一次合成的派生运行输出，字段和人都是编的。 */
const RUN_LOG = `[09:12:03] 开始派生：待读 128 段，嵌入空间 demo-space
[09:12:04] 第 1 批 32 段已提交
[09:12:09] 第 2 批 32 段已提交
[09:12:15] 第 3 批：2 段的回答没有通过校验，已跳过且不缓存
[09:12:21] 第 4 批 32 段已提交
[09:12:21] 完成：读了 126 段，跳过 2 段，用时 18 秒`;

/** 模型端点报错时交回的原文，合成的。 */
const ENDPOINT_ERROR = `{
  "status": 503,
  "error": "upstream unavailable",
  "endpoint": "https://llm.example.internal/v1/chat/completions",
  "retries": 3
}`;

function Playground() {
	const [variant, setVariant] = useState<Variant>("filled");
	const [wrap, setWrap] = useState(false);
	const [copyable, setCopyable] = useState(true);
	const [header, setHeader] = useState(false);
	const [limited, setLimited] = useState(false);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="变体">
					<Segmented<Variant>
						onChange={setVariant}
						options={VARIANTS.map((value) => ({ label: value, value }))}
						value={variant}
					/>
				</Control>
				<Control>
					<Checkbox checked={copyable} onChange={setCopyable}>
						可复制
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={wrap} onChange={setWrap}>
						折行
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={header} onChange={setHeader}>
						头部
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={limited} onChange={setLimited}>
						限高 120
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						<span>variant {variant}</span>
						<span>12px 等宽 · 行距 4</span>
						<span>悬停出复制钮与语言标签</span>
					</>
				}
			>
				<div className="w-full max-w-(--container-page)">
					<CodeBlock
						copyable={copyable}
						language="日志"
						maxHeight={limited ? 120 : undefined}
						title={header ? "运行日志" : undefined}
						variant={variant}
						wrap={wrap}
					>
						{RUN_LOG}
					</CodeBlock>
				</div>
			</Stage>
		</div>
	);
}

function Appearances() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>variant</TableHead>
						<TableHead>没有头部</TableHead>
						<TableHead>有头部</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{VARIANTS.map((variant) => (
						<TableRow key={variant}>
							<TableCell className="font-mono text-xs">{variant}</TableCell>
							<TableCell className="min-w-64">
								<CodeBlock language="JSON" variant={variant} wrap>
									{ENDPOINT_ERROR}
								</CodeBlock>
							</TableCell>
							<TableCell className="min-w-64">
								<CodeBlock title="端点返回" variant={variant} wrap>
									{ENDPOINT_ERROR}
								</CodeBlock>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="任务的原始输出按次收在「日志」里，打开才取；长的在块里滚动，不撑高对话框。"
				title="运行日志"
			>
				<CodeBlock className="w-full" language="日志" maxHeight={200} wrap>
					{RUN_LOG}
				</CodeBlock>
			</Example>
			<Example
				description="报错先用一句话说结论，原文收进提示条的详情里，要看才展开。"
				title="报错原文"
			>
				<Alert
					className="w-full"
					extra={
						<CodeBlock language="JSON" variant="borderless" wrap>
							{ENDPOINT_ERROR}
						</CodeBlock>
					}
					title="这次派生失败：AI 服务连不上"
					type="error"
				/>
			</Example>
		</ExampleGrid>
	);
}

/** 代码块页：试用、三种变体、产品里的两处用法。 */
export function CodeBlockPage() {
	return (
		<DocPage
			facts={[`${VARIANTS.length} 种变体`, "可复制", "可限高"]}
			rules={{
				notes: [
					"机器写的原文（运行输出、端点返回）用 CodeBlock，不手写 pre 和底色。",
					"原文只给管理员看；给 HR 的页面先用一句话说结论，原文不上屏。",
					"放进别的面里（提示条的详情、描边的块）用 borderless，不叠第二层底。",
					"长原文给 maxHeight，在块里滚动；日志一类一行很长的给 wrap。",
				],
				usage: `<CodeBlock language="日志" maxHeight={200} wrap>\n  {lines.join("\\n")}\n</CodeBlock>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用代码块" },
				{ children: <Appearances />, id: "appearance", title: "变体" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
