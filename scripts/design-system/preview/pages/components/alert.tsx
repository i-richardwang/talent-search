import { History } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Alert } from "#/components/ui/alert";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { CodeBlock } from "#/components/ui/code-block";
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
import { px, useMeasured } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

type AlertType = NonNullable<ComponentProps<typeof Alert>["type"]>;
type AlertVariant = NonNullable<ComponentProps<typeof Alert>["variant"]>;

const VARIANTS: AlertVariant[] = ["filled", "outlined", "borderless"];

/** 合成的端点报错原文，详情里用。 */
const ERROR_BODY = `{
  "status": 503,
  "error": "upstream unavailable",
  "retries": 3
}`;

const TYPES: AlertType[] = ["info", "success", "warning", "error", "secondary"];

/** 语气表每一行的文字，按语气给一句产品里会出现的话。 */
const TYPE_TITLE: Record<AlertType, string> = {
	error: "同步没有完成，人才库还是上一次的数据",
	info: "AI 搜索会把需求整理成搜索条件",
	secondary: "人才库里没有证书信息，这项要求没有加进搜索条件",
	success: "名单已导出，共 24 位候选人",
	warning: "有 3 份简历的日期不完整，没有进入人才库",
};

function Playground() {
	const [title, setTitle] = useState("有 3 份简历的日期不完整，没有进入人才库");
	const [type, setType] = useState<AlertType>("warning");
	const [variant, setVariant] = useState<AlertVariant>("filled");
	const [description, setDescription] = useState(true);
	const [showIcon, setShowIcon] = useState(true);
	const [closable, setClosable] = useState(true);
	const [extra, setExtra] = useState(false);
	// closable 的提示条自己收起：关掉之后换成一个重新显示的按钮，按下换一个 key 重新挂上。
	const [closed, setClosed] = useState(false);
	const [mount, setMount] = useState(0);
	const { reading: icon, ref } = useMeasured(
		(root) => root.querySelector("svg")?.getBoundingClientRect().width,
	);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control className="grow" htmlFor="playground-alert-title" label="标题">
					<Input
						id="playground-alert-title"
						onChange={(event) => setTitle(event.target.value)}
						value={title}
						variant="filled"
					/>
				</Control>
				<Control label="语气">
					<Segmented<AlertType>
						onChange={setType}
						options={[
							{ label: "信息", value: "info" },
							{ label: "成功", value: "success" },
							{ label: "留意", value: "warning" },
							{ label: "错误", value: "error" },
							{ label: "中性", value: "secondary" },
						]}
						value={type}
					/>
				</Control>
				<Control label="变体">
					<Segmented<AlertVariant>
						onChange={setVariant}
						options={VARIANTS.map((value) => ({ label: value, value }))}
						value={variant}
					/>
				</Control>
				<Control>
					<Checkbox checked={description} onChange={setDescription}>
						说明
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={showIcon} onChange={setShowIcon}>
						图标
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={closable} onChange={setClosable}>
						可关闭
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={extra} onChange={setExtra}>
						详情
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						<span>type {type}</span>
						<span>variant {variant}</span>
						{icon !== undefined && <span>图标 {px(icon)}</span>}
					</>
				}
			>
				<div
					className="flex w-full max-w-(--container-page) flex-col items-center gap-3"
					ref={ref}
				>
					{closed ? (
						<Button
							onClick={() => {
								setClosed(false);
								setMount((value) => value + 1);
							}}
							type="link"
						>
							重新显示提示
						</Button>
					) : (
						<Alert
							className="w-full"
							closable={closable}
							description={
								description
									? "这几份简历缺开始日期或结束日期早于开始日期，补全后下一次同步会收进来。"
									: undefined
							}
							extra={
								extra ? (
									<CodeBlock language="JSON" variant="borderless" wrap>
										{ERROR_BODY}
									</CodeBlock>
								) : undefined
							}
							key={mount}
							onClose={closable ? () => setClosed(true) : undefined}
							showIcon={showIcon}
							title={title}
							type={type}
							variant={variant}
						/>
					)}
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
						<TableHead>语气</TableHead>
						<TableHead>只有标题</TableHead>
						<TableHead>标题与说明</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{TYPES.map((type) => (
						<TableRow key={type}>
							<TableCell className="font-mono text-xs">{type}</TableCell>
							<TableCell>
								<Alert title={TYPE_TITLE[type]} type={type} />
							</TableCell>
							<TableCell>
								<Alert
									description="下一次同步后这里会更新。"
									title={TYPE_TITLE[type]}
									type={type}
								/>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Variants() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>variant</TableHead>
						<TableHead>只有标题</TableHead>
						<TableHead>带详情</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{VARIANTS.map((variant) => (
						<TableRow key={variant}>
							<TableCell className="font-mono text-xs">{variant}</TableCell>
							<TableCell className="min-w-64">
								<Alert
									title="AI 服务暂时连不上"
									type="error"
									variant={variant}
								/>
							</TableCell>
							<TableCell className="min-w-64">
								<Alert
									extra={
										<CodeBlock language="JSON" variant="borderless" wrap>
											{ERROR_BODY}
										</CodeBlock>
									}
									extraDefaultExpand
									title="AI 服务暂时连不上"
									type="error"
									variant={variant}
								/>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

/** 可关闭的提示：closable 的提示条自己收起，再给一个重新显示的按钮。 */
function ClosableExample() {
	const [open, setOpen] = useState(true);
	return open ? (
		<Alert
			className="w-full"
			closable
			onClose={() => setOpen(false)}
			role="status"
			title="名单已导出，共 24 位候选人"
			type="success"
		/>
	) : (
		<Button onClick={() => setOpen(true)} type="link">
			重新显示提示
		</Button>
	);
}

function Usage() {
	const [retrying, setRetrying] = useState(false);
	const retry = () => {
		setRetrying(true);
		window.setTimeout(() => setRetrying(false), 1200);
	};
	return (
		<ExampleGrid>
			<Example
				description="页面上发生的事用 Alert 说结论，能处理的附一个动作。"
				title="页面事件"
			>
				<Alert
					action={
						<Button loading={retrying} onClick={retry} size="small">
							重试
						</Button>
					}
					className="w-full"
					description="AI 服务暂时连不上，这句需求还没有被读过。"
					title="没有整理出搜索条件"
					type="error"
				/>
			</Example>
			<Example
				description="正在看较早的一次结果时用中性语气，换一个图标，附回到最新的动作。"
				title="中性说明"
			>
				<Alert
					action={<Button size="small">回到最新</Button>}
					className="w-full"
					icon={History}
					title="正在查看较早的一次结果。"
					type="secondary"
				/>
			</Example>
			<Example
				description="一次性的结果提示让 HR 自己关掉，不常驻在页面上。"
				title="可关闭"
			>
				<ClosableExample />
			</Example>
			<Example
				description="管理页的报错先说结论，端点交回的原文收进详情，要看才展开。"
				title="收着的原文"
			>
				<Alert
					className="w-full"
					extra={
						<CodeBlock language="JSON" variant="borderless" wrap>
							{ERROR_BODY}
						</CodeBlock>
					}
					title="这次派生失败"
					type="error"
				/>
			</Example>
		</ExampleGrid>
	);
}

/** 警告提示页：试用、语气、使用场景。 */
export function AlertPage() {
	return (
		<DocPage
			facts={[
				`${TYPES.length} 种语气`,
				`${VARIANTS.length} 种变体`,
				"可关闭",
				"可收详情",
			]}
			rules={{
				notes: [
					"页面事件用 Alert；查询条件的注解用行内文字，不用 Alert。",
					"色相只留给状态：warning 的 amber 表示需要留意，不拿语气色做装饰。",
					"文案站在 HR 这边说结论，不描述程序在做什么；出错时说清是哪一环坏了。",
					"管理页的常态交给共用的状态徽章，不用 Alert 重复提示。",
					"机器写的原文（端点返回、运行输出）放进 extra，默认收着；标题仍是给人看的结论。",
					"关掉就不再需要的提示用 closable；关掉后要由页面决定去留的，只给 onClose。",
				],
				usage: `<Alert\n  description="补全日期后下一次同步会收进来。"\n  title="3 份简历没有进入人才库"\n  type="warning"\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用警告提示" },
				{ children: <Appearances />, id: "appearance", title: "语气" },
				{ children: <Variants />, id: "variant", title: "变体" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
