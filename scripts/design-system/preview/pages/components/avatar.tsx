import { useState } from "react";
import { Avatar } from "#/components/ui/avatar";
import { Block } from "#/components/ui/block";
import { Input } from "#/components/ui/input";
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

const NAMES = ["AI", "林小雨", "陈一", "欧阳明远", "Talent 01"] as const;

function Playground() {
	const [name, setName] = useState("AI");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control className="grow" htmlFor="avatar-name" label="名字">
					<Input
						id="avatar-name"
						onChange={(event) => setName(event.target.value)}
						value={name}
					/>
				</Control>
			</Controls>
			<Stage>
				<Avatar title={name || " "} />
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
						<TableHead>名字</TableHead>
						<TableHead className="w-full">头像</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{NAMES.map((name) => (
						<TableRow key={name}>
							<TableCell className="text-xs">{name}</TableCell>
							<TableCell>
								<Avatar title={name} />
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
				description="对话线程里 AI 那一侧的每条回应，头像后面跟着「AI」和时刻。"
				title="AI 回应的署名"
			>
				<div className="flex items-center gap-2">
					<Avatar title="AI" />
					<span className="font-medium text-sm">AI</span>
					<span className="text-fg-tertiary text-xs">10:24</span>
				</div>
			</Example>
		</ExampleGrid>
	);
}

export function AvatarPage() {
	return (
		<DocPage
			facts={["名字缩写", "主色底"]}
			rules={{
				notes: [
					"头像是名字的缩写：含汉字的名字取末两个字，其余取头两个字符并大写。",
					"字色从底色自动取反差色，不在调用处改颜色、边长和圆角。",
					"头像旁边总写着全名，头像本身对读屏隐藏。",
				],
				usage: `<Avatar title="AI" />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用头像" },
				{ children: <Appearances />, id: "appearance", title: "名字" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
