import { Block } from "#/components/ui/block";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { originalValue } from "../../../shared/source";
import { tokenLabel } from "../../../shared/tokens/registry";
import { DocPage } from "../../kit/page";
import { useTokenNumber } from "../../state";

/** 名单那一列向两侧各让出的宽度，与 `styles.css` 里 `--container-app` 的算式一致。 */
const GUTTER = 48;

/** 常用的间距档：Tailwind 的间距单位是 4px，类名里的数乘 4 就是像素。 */
const STEPS = [
	[1, "图标与文字之间"],
	[2, "同一组控件之间"],
	[3, "卡片里的行与行"],
	[4, "卡片内边距、区块之间"],
	[6, "页面分节"],
	[8, "页面四周"],
] as const;

const LAYERS = [
	["--z-index-raise", "同一平面内的前后"],
	["--z-index-stick", "吸顶的栏"],
	["--z-index-frame", "页框的栏线"],
	["--z-index-escape", "跳过导航链接"],
	["--z-index-popup", "弹层"],
] as const;

/** 宽屏下并排的三栏：筛选栏、名单版心、右栏。 */
const COLUMNS = [
	"--container-rail",
	"--container-page",
	"--container-detail-wide",
] as const;

/** 定高的两条栏：顶栏与查询带。 */
const HEIGHTS = ["--header-height", "--deck-height"] as const;

function Columns() {
	const px = useTokenNumber();
	const columns = COLUMNS.map(
		(key) =>
			[key, px(key) + (key === "--container-page" ? GUTTER * 2 : 0)] as const,
	);
	const total = columns.reduce((sum, [, width]) => sum + width, 0);
	return (
		<Block gap={16} padding={20} variant="outlined">
			<div className="flex h-24 gap-px overflow-hidden rounded-md">
				{columns.map(([key, width]) => (
					<div
						className="flex min-w-0 flex-col items-center justify-center gap-1 bg-fill-tertiary text-xs"
						key={key}
						style={{ flexGrow: width }}
					>
						<span className="font-medium">{tokenLabel(key)}</span>
						<span className="text-fg-tertiary tabular-nums">
							{key === "--container-page"
								? `${px(key)} + 两侧各 ${GUTTER}`
								: px(key)}
						</span>
					</div>
				))}
			</div>
			<p className="text-fg-secondary text-xs tabular-nums">
				页宽列 {total}
				px：筛选栏、名单版心加两侧留白、宽屏右栏三段相加，改其中一栏整列跟着变。
				窄屏右栏是 {px("--container-detail")}px。
			</p>
		</Block>
	);
}

function Heights() {
	const px = useTokenNumber();
	return (
		<Block gap={0} variant="outlined">
			{HEIGHTS.map((key) => (
				<div
					className="flex items-center gap-4 border-border-secondary border-b px-5 py-3 last:border-b-0"
					key={key}
				>
					<div className="flex w-40 shrink-0 flex-col gap-0.5 text-xs">
						<span className="font-medium">{tokenLabel(key)}</span>
						<code className="text-fg-tertiary">{key}</code>
					</div>
					<div
						className="w-full rounded-sm bg-fill-tertiary"
						style={{ height: px(key) }}
					/>
					<span className="w-12 shrink-0 text-right text-fg-tertiary text-xs tabular-nums">
						{px(key)}px
					</span>
				</div>
			))}
		</Block>
	);
}

function Steps() {
	return (
		<Block gap={0} variant="outlined">
			{STEPS.map(([step, use]) => (
				<div
					className="flex items-center gap-4 border-border-secondary border-b px-5 py-3 last:border-b-0"
					key={step}
				>
					<code className="w-16 shrink-0 text-xs">gap-{step}</code>
					<div className="w-16 shrink-0">
						<div
							className="h-3 rounded-xs bg-primary"
							style={{ width: step * 4 }}
						/>
					</div>
					<span className="w-12 shrink-0 text-fg-tertiary text-xs tabular-nums">
						{step * 4}px
					</span>
					<span className="text-fg-secondary text-xs">{use}</span>
				</div>
			))}
		</Block>
	);
}

function Layers() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table size="middle">
				<TableHeader>
					<TableRow>
						<TableHead>层级</TableHead>
						<TableHead>值</TableHead>
						<TableHead>用在</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{LAYERS.map(([key, use]) => (
						<TableRow key={key}>
							<TableCell className="font-mono text-xs">{key}</TableCell>
							<TableCell className="tabular-nums">
								{originalValue("shared", key)}
							</TableCell>
							<TableCell>{use}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

/** 间距与版心：页宽列怎么分栏、顶部两条栏多高、常用间距档，以及层级尺度。 */
export function SpacingPage() {
	return (
		<DocPage
			facts={[
				`${COLUMNS.length} 栏`,
				`${HEIGHTS.length} 条定高的栏`,
				`${LAYERS.length} 档层级`,
			]}
			sections={[
				{ children: <Columns />, id: "columns", title: "版心与栏宽" },
				{ children: <Heights />, id: "heights", title: "栏高" },
				{ children: <Steps />, id: "steps", title: "间距" },
				{ children: <Layers />, id: "layers", title: "层级" },
			]}
		/>
	);
}
