import type { ReactNode } from "react";
import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Segmented } from "#/components/ui/segmented";
import { Skeleton } from "#/components/ui/skeleton";
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

/** 形状表的行：写法与一个示例。 */
const SHAPES: [code: string, shape: ReactNode][] = [
	["Skeleton", <Skeleton height={32} key="block" width={96} />],
	["Skeleton.Text", <Skeleton.Text key="text" rows={2} />],
];

function Playground() {
	const [rows, setRows] = useState("3");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="文字行数">
					<Segmented
						onChange={setRows}
						options={["1", "2", "3", "5"]}
						value={rows}
					/>
				</Control>
			</Controls>
			<Stage footer={<span>多行时末行短一截</span>}>
				<div className="w-full max-w-md">
					<Skeleton.Text rows={Number(rows)} />
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
						<TableHead>形状</TableHead>
						<TableHead className="w-full">明暗呼吸</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{SHAPES.map(([code, shape]) => (
						<TableRow key={code}>
							<TableCell className="font-mono text-xs">{code}</TableCell>
							<TableCell>{shape}</TableCell>
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
				description="人的详情加载时，标题行用 1lh 的高度占住一行字，内容到了不会跳。"
				title="详情头部"
			>
				<div className="flex w-full flex-col gap-3">
					<div className="flex flex-col gap-0.5">
						<h2 className="font-semibold text-lg">
							<Skeleton height="1lh" width="8rem" />
						</h2>
						<div className="text-base">
							<Skeleton height="1lh" width="12rem" />
						</div>
					</div>
					<Skeleton.Text rows={3} />
				</div>
			</Example>
			<Example
				description="换查询时名单用和真卡片同样大小的占位，数量与一页的张数一致。"
				title="名单卡片"
			>
				<div className="flex w-full flex-col gap-2">
					{["a", "b", "c"].map((key) => (
						<Block
							gap={10}
							horizontal
							key={key}
							padding={12}
							variant="outlined"
						>
							<Skeleton.Text rows={2} />
						</Block>
					))}
				</div>
			</Example>
			<Example
				description="数值还在算时，只占住那个数的位置，周围的字照常显示。"
				title="行内数值"
			>
				<div className="flex items-center gap-2 text-sm">
					找到
					<Skeleton height="1lh" width="2.5em" />人
				</div>
			</Example>
		</ExampleGrid>
	);
}

/** 骨架屏页：行数的试用，各种形状，产品里的占位写法。 */
export function SkeletonPage() {
	return (
		<DocPage
			facts={[`${SHAPES.length} 种形状`, "明暗呼吸"]}
			rules={{
				notes: [
					'占位的大小与真内容一致：文字用 Skeleton.Text 或 height="1lh"，内容到了不晃。',
					"占位只画将要出现的那几块，不填满多余的空间。",
					"Skeleton 的宽、高用 props 给，不覆盖底色和圆角。",
					"系统开了减少动效时动画自动停，不另写判断。",
				],
				usage: `<Skeleton height="1lh" width="8rem" />\n<Skeleton.Text rows={3} />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用骨架屏" },
				{ children: <Appearances />, id: "appearance", title: "形状" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
