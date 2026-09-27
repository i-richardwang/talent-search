import { SearchX, UserX } from "lucide-react";
import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Empty } from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
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

type Cover = "simple" | "icon";
type Size = "middle" | "large";

const SIZES: { label: string; value: Size }[] = [
	{ label: "面里 middle", value: "middle" },
	{ label: "整栏 large", value: "large" },
];

const COVERS: { label: string; value: Cover }[] = [
	{ label: "简笔图", value: "simple" },
	{ label: "图标", value: "icon" },
];

function Playground() {
	const [cover, setCover] = useState<Cover>("icon");
	const [title, setTitle] = useState("没有符合全部条件的人");
	const [description, setDescription] = useState(
		"「累计 8 年以上」把范围收得太窄，可以放宽年限再看。",
	);
	const [action, setAction] = useState(true);
	const [size, setSize] = useState<Size>("middle");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control className="grow" htmlFor="empty-title" label="标题">
					<Input
						id="empty-title"
						onChange={(event) => setTitle(event.target.value)}
						value={title}
						variant="filled"
					/>
				</Control>
				<Control className="grow" htmlFor="empty-description" label="说明">
					<Input
						id="empty-description"
						onChange={(event) => setDescription(event.target.value)}
						value={description}
						variant="filled"
					/>
				</Control>
				<Control label="图">
					<Segmented<Cover>
						onChange={setCover}
						options={COVERS}
						value={cover}
					/>
				</Control>
				<Control label="尺寸">
					<Segmented<Size> onChange={setSize} options={SIZES} value={size} />
				</Control>
				<Control>
					<Checkbox checked={action} onChange={setAction}>
						动作
					</Checkbox>
				</Control>
			</Controls>
			<Stage>
				<Empty
					action={action ? <Button type="primary">放宽年限</Button> : undefined}
					description={description || undefined}
					icon={cover === "icon" ? SearchX : undefined}
					size={size}
					title={title || undefined}
				/>
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
						<TableHead>图</TableHead>
						<TableHead>标题与说明</TableHead>
						<TableHead>只有标题</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell className="font-mono text-xs">simple</TableCell>
						<TableCell>
							<Empty
								description="经历处理完成后，这里会列出技能及相关写法。"
								title="还没有技能"
							/>
						</TableCell>
						<TableCell>
							<Empty title="没有匹配的技能" />
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">icon</TableCell>
						<TableCell>
							<Empty
								description="链接可能已失效，或记录已被清理。"
								icon={UserX}
								title="没有找到这个人"
							/>
						</TableCell>
						<TableCell>
							<Empty icon={UserX} title="没有找到这个人" />
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">large</TableCell>
						<TableCell>
							<Empty
								description="链接可能已失效，或记录已被清理。"
								icon={UserX}
								size="large"
								title="没有找到这个人"
							/>
						</TableCell>
						<TableCell>
							<Empty icon={UserX} size="large" title="没有找到这个人" />
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="名单那一栏为空时占满整栏（large）：说出是哪条条件挡住了人，并给一个能直接点的出路。"
				title="名单为空"
			>
				<Empty
					action={<Button>去掉「学校」这条</Button>}
					className="w-full"
					description="加上「学校」后一个人都不剩，其余条件下有 23 人。"
					icon={SearchX}
					size="large"
					title="没有符合全部条件的人"
				/>
			</Example>
			<Example
				description="管理页的表里搜不到时，标题已经说清楚，不加说明。"
				title="表内搜不到"
			>
				<Block className="w-full overflow-hidden" variant="outlined">
					<Empty title="没有匹配的技能" />
				</Block>
			</Example>
			<Example
				description="人才库还没有数据时，说明下一步找谁，而不是描述程序状态。"
				title="还没有数据"
			>
				<Empty
					className="w-full"
					description="还没有同步任何简历，请联系管理员。"
					title="人才库还是空的"
				/>
			</Example>
		</ExampleGrid>
	);
}

/** 空状态页：文字与图的试用，图与文字的矩阵，产品里的几种空态。 */
export function EmptyPage() {
	return (
		<DocPage
			facts={[`${COVERS.length} 种图`, `${SIZES.length} 种尺寸`, "居中一列"]}
			rules={{
				notes: [
					"空态用 Empty，不手写一块灰字。",
					"文案说明当前问题和可执行的出路；标题已说明的内容，说明里不重复。",
					"空态原因由检索层判定，界面按原因给文案，不拿计数重新推断。",
					"出路是一次动作时放进 action，用 Button。",
					"放在一块面里（表格、抽屉、弹层）用缺省的 middle；一整栏或一整页为空用 large，不在调用处加上下内边距。",
				],
				usage: `<Empty\n  action={<Button>放宽年限</Button>}\n  description="「累计 8 年以上」把范围收得太窄，可以放宽年限再看。"\n  title="没有符合全部条件的人"\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用空状态" },
				{ children: <Appearances />, id: "appearance", title: "外观与状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
