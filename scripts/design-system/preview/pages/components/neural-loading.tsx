import { CheckIcon } from "lucide-react";
import { Block } from "#/components/ui/block";
import { Icon } from "#/components/ui/icon";
import { NeuralLoading } from "#/components/ui/neural-loading";
import { Text } from "#/components/ui/text";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

const SIZES = [12, 16, 24, 40] as const;

function Playground() {
	return (
		<Stage
			footer={
				<>
					<span>一轮 2 秒，外圈 20 秒一圈</span>
					<span>颜色取次要字色</span>
				</>
			}
		>
			<div className="flex items-end gap-6">
				{SIZES.map((size) => (
					<div className="flex flex-col items-center gap-2" key={size}>
						<NeuralLoading size={size} />
						<Text size="xs" type="tertiary">
							{size}px
						</Text>
					</div>
				))}
			</div>
		</Stage>
	);
}

/** 24px 描边的状态格，里面是 16px 的图标：检索过程每一行的行首。 */
function StatusCell({ live }: { live: boolean }) {
	return (
		<Block
			align="center"
			height={24}
			horizontal
			justify="center"
			variant="outlined"
			width={24}
		>
			{live ? (
				<NeuralLoading size={16} />
			) : (
				<Icon className="text-success" icon={CheckIcon} size={12} />
			)}
		</Block>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="AI 在检索人才库时，状态格里是它；这一步走完换成绿色对勾，格子不变大小。"
				title="检索过程的状态格"
			>
				<div className="flex flex-col gap-2">
					<span className="flex items-center gap-1.5">
						<StatusCell live />
						<Text shiny type="secondary">
							检索人才库 2 步
						</Text>
					</span>
					<span className="flex items-center gap-1.5">
						<StatusCell live={false} />
						<Text type="secondary">检索人才库 3 步</Text>
					</span>
				</div>
			</Example>
		</ExampleGrid>
	);
}

/** 模型在跑的小图标页：几档尺寸、检索过程里的用法。 */
export function NeuralLoadingPage() {
	return (
		<DocPage
			facts={[`${SIZES.length} 档尺寸演示`, "对读屏隐藏"]}
			rules={{
				notes: [
					"只表示 AI 正在做事；普通的等待用按钮自带的等待态或骨架屏。",
					"旁边总有一句正在做什么的话，图标本身不给读屏读。",
					"放在状态格里时和完成后的对勾同一个尺寸，换状态时格子不动。",
				],
				usage: `<NeuralLoading size={16} />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
