import { CodeBlock } from "#/components/ui/code-block";
import { CopyButton } from "#/components/ui/copy-button";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

/** 合成的工号，不是任何真人的。 */
const EMP_ID = "E0012345";

function Playground() {
	return (
		<Stage
			footer={
				<>
					<span>按下后 2 秒是对勾与 active 态</span>
					<span>尺寸同 ActionIcon</span>
				</>
			}
		>
			<div className="flex items-center gap-3">
				<CopyButton content={EMP_ID} size="small" />
				<CopyButton content={EMP_ID} size="header" />
				<CopyButton content={EMP_ID} />
			</div>
		</Stage>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="标题旁的工号：small 一档跟在字后面，提示说清复制的是什么。"
				title="复制工号"
			>
				<span className="inline-flex items-center gap-1 font-semibold text-lg">
					候选人 A
					<span className="ms-1 font-mono font-normal text-base text-fg-secondary">
						{EMP_ID}
					</span>
					<CopyButton content={EMP_ID} size="small" title="复制工号" />
				</span>
			</Example>
			<Example
				description="代码块的复制钮就是它，浮在内容上。"
				title="压在内容上"
			>
				<CodeBlock language="日志">
					{"[09:12:21] 完成：读了 126 段，跳过 2 段，用时 18 秒"}
				</CodeBlock>
			</Example>
		</ExampleGrid>
	);
}

export function CopyButtonPage() {
	return (
		<DocPage
			facts={["2 秒已复制态"]}
			rules={{
				notes: [
					"复制一段值用 CopyButton，不自己拼剪贴板和对勾图标。",
					"按下之后图标换成对勾，2 秒后回来；不另弹提示。",
					"只有图标，title 写清复制的是什么，它同时是按钮的名字。",
				],
				usage: `<CopyButton content={empId} size="small" title="复制工号" />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用复制按钮" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
