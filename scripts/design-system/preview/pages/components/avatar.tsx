import { useState } from "react";
import { Avatar } from "#/components/ui/avatar";
import { Block } from "#/components/ui/block";
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

type Shape = "square" | "circle";

const SHAPES: { label: string; value: Shape }[] = [
	{ label: "方形", value: "square" },
	{ label: "圆形", value: "circle" },
];

const SIZES = [20, 24, 32, 40, 48] as const;
type Size = `${(typeof SIZES)[number]}`;

/** 几种名字：三个字、两个字、四个字、拉丁字母。 */
const NAMES = ["林小雨", "陈一", "欧阳明远", "Talent 01"] as const;

function Playground() {
	const [name, setName] = useState("林小雨");
	const [shape, setShape] = useState<Shape>("square");
	const [picked, setPicked] = useState<Size>("48");
	const size = Number(picked);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control className="grow" htmlFor="avatar-name" label="名字">
					<Input
						id="avatar-name"
						onChange={(event) => setName(event.target.value)}
						value={name}
						variant="filled"
					/>
				</Control>
				<Control label="形状">
					<Segmented<Shape>
						onChange={setShape}
						options={SHAPES}
						value={shape}
					/>
				</Control>
				<Control label="边长">
					<Segmented<Size>
						onChange={setPicked}
						options={SIZES.map((value) => `${value}` as Size)}
						value={picked}
					/>
				</Control>
			</Controls>
			<Stage
				footer={
					<span className="font-mono">
						{shape} · {size}px · 圆角{" "}
						{shape === "circle"
							? "50%"
							: size < 24
								? "33%"
								: `${Math.max(size / 6, 2)}px`}
					</span>
				}
			>
				<Avatar shape={shape} size={size} title={name || " "} />
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
						{SIZES.map((size) => (
							<TableHead key={size}>{size}</TableHead>
						))}
						<TableHead>圆形 32</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{NAMES.map((name) => (
						<TableRow key={name}>
							<TableCell className="text-xs">{name}</TableCell>
							{SIZES.map((size) => (
								<TableCell key={size}>
									<Avatar size={size} title={name} />
								</TableCell>
							))}
							<TableCell>
								<Avatar shape="circle" size={32} title={name} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	const people = [
		{ name: "林小雨", note: "高级算法工程师 · 推荐算法部" },
		{ name: "欧阳明远", note: "数据工程师 · 数据平台部" },
	];
	return (
		<ExampleGrid>
			<Example
				description="一行一个人：32px 的头像在左，名字 14px 中粗，下面一行 12px 次要色的岗位。"
				title="人的一行"
			>
				<div className="flex w-full flex-col">
					{people.map((person) => (
						<div className="flex items-center gap-3 py-2" key={person.name}>
							<Avatar size={32} title={person.name} />
							<div className="flex min-w-0 flex-col">
								<span className="truncate font-medium text-base">
									{person.name}
								</span>
								<span className="truncate text-fg-secondary text-xs">
									{person.note}
								</span>
							</div>
						</div>
					))}
				</div>
			</Example>
			<Example
				description="右栏详情顶上：48px 的头像跟着名字和岗位。"
				title="详情页头"
			>
				<div className="flex items-center gap-3">
					<Avatar title="林小雨" />
					<div className="flex flex-col">
						<span className="font-semibold text-lg">林小雨</span>
						<span className="text-fg-tertiary text-sm">
							高级算法工程师 · L7
						</span>
					</div>
				</div>
			</Example>
		</ExampleGrid>
	);
}

/** 头像页：试用、名字与尺寸的矩阵、产品里的用法。 */
export function AvatarPage() {
	return (
		<DocPage
			facts={["名字缩写", `${SIZES.length} 种常用边长`, "方形与圆形"]}
			rules={{
				notes: [
					"人才库没有照片，头像就是名字的缩写：含汉字的名字取末两个字，其余取头两个字符并大写。",
					"底色缺省是 border 那一档灰，字色自动取反差色；不按名字给每个人配颜色。",
					"方形的圆角随边长走（边长的六分之一，不到 24 时是 33%），不在调用处改圆角。",
					"头像旁边总写着全名，头像本身对读屏隐藏。",
				],
				usage: `<Avatar size={32} title={name} />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用头像" },
				{ children: <Appearances />, id: "appearance", title: "名字与边长" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
