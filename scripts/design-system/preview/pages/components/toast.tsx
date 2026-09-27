import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
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
import { type ToastType, toast } from "#/components/ui/toast";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

const TYPES: { label: string; value: ToastType }[] = [
	{ label: "普通", value: "default" },
	{ label: "成功", value: "success" },
	{ label: "信息", value: "info" },
	{ label: "留意", value: "warning" },
	{ label: "失败", value: "error" },
	{ label: "等待", value: "loading" },
];

/** 形态表的行：写法、什么时候用、示例的参数。 */
const FORMS: [call: string, when: string, show: () => void][] = [
	["toast.success(文字)", "一次动作办成了", () => toast.success("名单已导出")],
	[
		"toast.error({ title, description })",
		"动作没办成，说清哪里坏了",
		() =>
			toast.error({
				description: "AI 服务暂时连不上，稍后再试。",
				title: "没能删除这次搜索",
			}),
	],
	[
		"toast.warning(文字)",
		"没执行，要留意",
		() => toast.warning("已有任务在排队，这次没有加入"),
	],
	["toast.info(文字)", "顺带告诉一声", () => toast.info("搜索链接已复制")],
	[
		"toast.loading(文字)",
		"要等一会儿，不自己关",
		() => {
			const waiting = toast.loading("正在准备名单…");
			setTimeout(() => waiting.close(), 2400);
		},
	],
	[
		"actions",
		"失败了可以当场重试",
		() =>
			toast.error({
				actions: [{ label: "重试", onClick: () => toast.success("已删除") }],
				description: "网络断开了。",
				title: "没能删除这次搜索",
			}),
	],
];

function Playground() {
	const [type, setType] = useState<ToastType>("success");
	const [withTitle, setWithTitle] = useState(true);
	const [withAction, setWithAction] = useState(false);
	const [description, setDescription] = useState("已导出 12 人的名单");
	const show = () => {
		const options = {
			actions: withAction
				? [
						{ label: "打开", variant: "primary" as const },
						{ label: "撤销", variant: "text" as const },
					]
				: undefined,
			description: description || undefined,
			title: withTitle ? "导出完成" : undefined,
		};
		if (type === "default") toast(options);
		else toast[type](options);
	};
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="状态">
					<Segmented<ToastType>
						onChange={setType}
						options={TYPES}
						value={type}
					/>
				</Control>
				<Control
					className="grow"
					htmlFor="playground-toast-description"
					label="正文"
				>
					<Input
						id="playground-toast-description"
						onChange={(event) => setDescription(event.target.value)}
						value={description}
						variant="filled"
					/>
				</Control>
				<Control>
					<Checkbox checked={withTitle} onChange={setWithTitle}>
						标题
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={withAction} onChange={setWithAction}>
						按钮
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						<span>右下角，宽 360px</span>
						<span>5 秒后关，等待不自己关</span>
						<span>最多 5 条</span>
					</>
				}
			>
				<div className="flex gap-2">
					<Button onClick={show} type="primary">
						显示通知
					</Button>
					<Button onClick={() => toast.dismiss()}>全部关掉</Button>
				</div>
			</Stage>
		</div>
	);
}

function Forms() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>写法</TableHead>
						<TableHead>什么时候用</TableHead>
						<TableHead>示例</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{FORMS.map(([call, when, show]) => (
						<TableRow key={call}>
							<TableCell className="font-mono text-xs">{call}</TableCell>
							<TableCell className="text-fg-secondary">{when}</TableCell>
							<TableCell>
								<Button onClick={show} size="small">
									显示
								</Button>
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
				description="下载在后台准备，完了换成成功或失败的那一条；按钮本身不另画等待。"
				title="导出名单"
			>
				<Button
					onClick={() =>
						toast
							.promise(
								new Promise<number>((resolve) =>
									setTimeout(() => resolve(12), 1600),
								),
								{
									error: "没能导出名单",
									loading: "正在准备名单…",
									success: (count) => `已导出 ${count} 人`,
								},
							)
							.catch(() => {})
					}
				>
					导出 CSV
				</Button>
			</Example>
			<Example
				description="同一个 id 连点几次只有一条，原地刷新并重新计时。"
				title="重复的提醒"
			>
				<Button
					onClick={() =>
						toast.warning({
							id: "task-queued",
							title: "已有任务在排队",
						})
					}
				>
					再排一次同步
				</Button>
			</Example>
		</ExampleGrid>
	);
}

/** 通知页：试用、几种状态、使用场景。 */
export function ToastPage() {
	return (
		<DocPage
			facts={[`${TYPES.length} 种状态`, "右下角叠放", "指针移上去展开"]}
			rules={{
				notes: [
					"<Toaster /> 在应用根上挂一次；其余地方只调 toast.success / error / warning / info / loading。",
					"通知说一次动作的结果：办成了、没办成、没执行。页面上一直成立的状态用 Alert，不用通知。",
					"失败的通知给 title 说哪件事没办成，description 说哪一环坏了；能当场重试就给「重试」按钮。",
					"会重复触发的提醒给 id，同一件事只留一条。",
					"文字站在 HR 这边说结论，不描述程序在做什么。",
				],
				usage: `toast.success("名单已导出");\n\ntoast.error({\n  title: "没能删除这次搜索",\n  description: "网络断开了。",\n  actions: [{ label: "重试", onClick: retry }],\n});`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用通知" },
				{ children: <Forms />, id: "appearance", title: "外观与状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
