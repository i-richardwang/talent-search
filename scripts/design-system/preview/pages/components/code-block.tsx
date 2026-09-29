import { CodeBlock } from "#/components/ui/code-block";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

/** 一次合成的派生运行输出，字段和人都是编的。 */
const RUN_LOG = `[09:12:03] 开始派生：待读 128 段，嵌入空间 demo-space
[09:12:04] 第 1 批 32 段已提交
[09:12:09] 第 2 批 32 段已提交
[09:12:15] 第 3 批：2 段的回答没有通过校验，已跳过且不缓存
[09:12:21] 第 4 批 32 段已提交
[09:12:21] 完成：读了 126 段，跳过 2 段，用时 18 秒`;

function Playground() {
	return (
		<Stage
			footer={
				<>
					<span>12px 等宽 · 行距 4</span>
					<span>长行折行</span>
					<span>悬停出复制钮与语言标签</span>
				</>
			}
		>
			<div className="w-full max-w-(--container-page)">
				<CodeBlock language="日志">{RUN_LOG}</CodeBlock>
			</div>
		</Stage>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="任务的原始输出按次收在「日志」抽屉里，打开才取。"
				title="运行日志"
			>
				<CodeBlock language="日志">{RUN_LOG}</CodeBlock>
			</Example>
		</ExampleGrid>
	);
}

export function CodeBlockPage() {
	return (
		<DocPage
			facts={["可复制", "长行折行"]}
			rules={{
				notes: [
					"机器写的原文（运行输出）用 CodeBlock，不手写 pre 和底色。",
					"原文只给管理员看；给 HR 的页面先用一句话说结论，原文不显示。",
				],
				usage: `<CodeBlock language="日志">\n  {lines.join("\\n")}\n</CodeBlock>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用代码块" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
