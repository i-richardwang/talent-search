import { Block } from "#/components/ui/block";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { TextLink } from "#/components/ui/text-link";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { stay } from "../../kit/stay";

function Playground() {
	return (
		<Stage footer={<span>颜色跟着所在的字 · 悬停出下划线</span>}>
			<div className="flex flex-col gap-3 text-sm">
				<p className="font-medium text-fg">
					<TextLink href="#" onClick={stay}>
						推荐系统
					</TextLink>
				</p>
				<p className="text-fg-secondary">
					属于{" "}
					<TextLink href="#" onClick={stay}>
						机器学习
					</TextLink>
				</p>
			</div>
		</Stage>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="表里通往详情的是名字那一格的文字：和那一格同色同重，悬停才露出是链接。"
				title="表里的名字"
			>
				<Block className="w-full overflow-hidden" variant="outlined">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>技能</TableHead>
								<TableHead className="text-end">人数</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{[
								["推荐系统", 5],
								["数据分析", 3],
							].map(([word, people]) => (
								<TableRow key={word}>
									<TableCell className="whitespace-nowrap font-medium">
										<TextLink href="#" onClick={stay}>
											{word}
										</TextLink>
									</TableCell>
									<TableCell className="text-end tabular-nums">
										{people}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Block>
			</Example>
			<Example
				description="详情里相邻的词：词连着它那一支的人数一起点，人数退一档颜色。"
				title="相邻的词"
			>
				<TextLink className="text-sm" href="#" onClick={stay}>
					机器学习
					<span className="ms-2 text-fg-secondary tabular-nums">9</span>
				</TextLink>
			</Example>
		</ExampleGrid>
	);
}

export function TextLinkPage() {
	return (
		<DocPage
			facts={["颜色继承", "悬停下划线"]}
			rules={{
				notes: [
					"通往一个对象详情的几个字用 TextLink，站内跳转把路由的 Link 交给 render。",
					"颜色、字重、字号跟着所在的字走，调用处在外层写，不给链接另染颜色。",
					"整块可点的名单行用 Block 的 BlockLink，按钮样子的跳转用 Button 的 render，不用它。",
				],
				usage: `<TextLink render={<Link params={{ word }} to="/skills/$word" />}>\n  {word}\n</TextLink>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用文字链接" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
