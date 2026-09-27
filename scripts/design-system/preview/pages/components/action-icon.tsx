import {
	ArrowDown,
	ArrowUp,
	Copy,
	Ellipsis,
	type LucideIcon,
	RefreshCw,
	Star,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import { ActionIcon, type ActionIconProps } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import {
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { TextArea } from "#/components/ui/input";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import {
	Toolbar,
	ToolbarButton,
	ToolbarSeparator,
} from "#/components/ui/toolbar";
import { COMPONENT_TIERS, type TierOf } from "../../../shared/tokens/registry";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { px, SizeCell, useMeasured } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { useTier } from "../../state";

type State = "default" | "active" | "disabled" | "loading";
type ActionIconVariant = NonNullable<ActionIconProps["variant"]>;
type Tier = TierOf<"action-icon">;

const VARIANTS: ActionIconVariant[] = ["borderless", "filled", "outlined"];

const ICONS: Record<string, [icon: LucideIcon, title: string]> = {
	copy: [Copy, "复制搜索条件"],
	refresh: [RefreshCw, "重新搜索"],
	star: [Star, "收藏候选人"],
	trash: [Trash2, "删除这次搜索"],
};

/** 量试用里那个图标按钮：方块边长、圆角与图标边长。 */
function measureIcon(root: HTMLElement) {
	const button = root.querySelector("button");
	const glyph = button?.querySelector("svg");
	if (!button || !glyph) return undefined;
	return {
		block: button.getBoundingClientRect().width,
		glyph: glyph.getBoundingClientRect().width,
		radius: Number.parseFloat(getComputedStyle(button).borderTopLeftRadius),
	};
}

function Playground() {
	const [icon, setIcon] = useState("star");
	const [variant, setVariant] = useState<ActionIconVariant>("borderless");
	const [state, setState] = useState<State>("default");
	const [withTitle, setWithTitle] = useState(true);
	const sizeTier = useTier("action-icon");
	const { reading, ref } = useMeasured(measureIcon);
	const [glyph, title] = ICONS[icon] ?? [Star, "收藏候选人"];
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="图标">
					<Segmented
						onChange={setIcon}
						options={[
							{ label: "收藏", value: "star" },
							{ label: "复制", value: "copy" },
							{ label: "刷新", value: "refresh" },
							{ label: "删除", value: "trash" },
						]}
						value={icon}
					/>
				</Control>
				<Control label="外观">
					<Segmented<ActionIconVariant>
						onChange={setVariant}
						options={[
							{ label: "无边框", value: "borderless" },
							{ label: "填充", value: "filled" },
							{ label: "描边", value: "outlined" },
						]}
						value={variant}
					/>
				</Control>
				<Control label="状态">
					<Segmented<State>
						onChange={setState}
						options={[
							{ label: "默认", value: "default" },
							{ label: "激活", value: "active" },
							{ label: "禁用", value: "disabled" },
							{ label: "加载中", value: "loading" },
						]}
						value={state}
					/>
				</Control>
				<Control>
					<Checkbox checked={withTitle} onChange={setWithTitle}>
						悬停提示
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					reading && (
						<>
							<span>方块 {px(reading.block)}</span>
							<span>圆角 {px(reading.radius)}</span>
							<span>图标 {px(reading.glyph)}</span>
						</>
					)
				}
			>
				<div className="contents" ref={ref}>
					<ActionIcon
						active={state === "active"}
						aria-label={title}
						disabled={state === "disabled"}
						icon={glyph}
						loading={state === "loading"}
						size={sizeTier}
						title={withTitle ? title : undefined}
						variant={variant}
					/>
				</div>
			</Stage>
		</div>
	);
}

const COPY = "复制搜索条件";

function Appearances() {
	const sizeTier = useTier("action-icon");
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>外观</TableHead>
						<TableHead>默认 · 可交互</TableHead>
						<TableHead>激活</TableHead>
						<TableHead>禁用</TableHead>
						<TableHead>加载中</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{VARIANTS.map((variant) => (
						<TableRow key={variant}>
							<TableCell className="font-mono text-xs">{variant}</TableCell>
							<TableCell>
								<ActionIcon
									aria-label={COPY}
									icon={Copy}
									size={sizeTier}
									title={COPY}
									variant={variant}
								/>
							</TableCell>
							<TableCell>
								<ActionIcon
									active
									aria-label={COPY}
									icon={Copy}
									size={sizeTier}
									variant={variant}
								/>
							</TableCell>
							<TableCell>
								<ActionIcon
									aria-label={COPY}
									disabled
									icon={Copy}
									size={sizeTier}
									variant={variant}
								/>
							</TableCell>
							<TableCell>
								<ActionIcon
									aria-label={COPY}
									icon={Copy}
									loading
									size={sizeTier}
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

/** 尺寸表的一行：跟着右栏选中的档高亮。 */
function SizeRow({ size }: { size: Tier }) {
	const sizeTier = useTier("action-icon");
	return (
		<TableRow data-state={size === sizeTier ? "selected" : undefined}>
			<TableCell>
				<SizeCell group="action-icon" tier={size} />
			</TableCell>
			{VARIANTS.map((variant) => (
				<TableCell key={variant}>
					<ActionIcon
						aria-label="复制搜索条件"
						icon={Copy}
						size={size}
						variant={variant}
					/>
				</TableCell>
			))}
		</TableRow>
	);
}

function Sizes() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>尺寸</TableHead>
						{VARIANTS.map((variant) => (
							<TableHead className="font-mono" key={variant}>
								{variant}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{COMPONENT_TIERS["action-icon"].map((size) => (
						<SizeRow key={size} size={size} />
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	const [starred, setStarred] = useState(false);
	const [draft, setDraft] = useState("");
	return (
		<ExampleGrid>
			<Example
				description="只有图标的按钮必须有名字：title 给悬停提示，aria-label 给读屏；active 表示开关已打开。"
				title="候选人卡片上的动作"
			>
				<Toolbar aria-label="候选人 A 的动作">
					<ToolbarButton
						render={
							<ActionIcon
								active={starred}
								aria-label={starred ? "取消收藏" : "收藏候选人"}
								icon={Star}
								onClick={() => setStarred(!starred)}
								size="small"
								title={starred ? "取消收藏" : "收藏候选人"}
							/>
						}
					/>
					<ToolbarButton
						render={
							<ActionIcon
								aria-label="复制简历链接"
								icon={Copy}
								size="small"
								title="复制简历链接"
							/>
						}
					/>
					<ToolbarSeparator />
					<ToolbarButton
						render={
							<ActionIcon
								aria-label="移出名单"
								icon={Trash2}
								size="small"
								title="移出名单"
							/>
						}
					/>
				</Toolbar>
			</Example>
			<Example
				description="提交放进输入框的底栏，用 filled 的小号；没写需求时禁用。"
				title="输入框里的提交"
			>
				<TextArea
					aria-label="需求"
					autoSize={{ minRows: 2 }}
					onChange={(event) => setDraft(event.target.value)}
					placeholder="描述要找的人，比如做过支付风控的后端"
					value={draft}
				/>
				<ActionIcon
					aria-label="搜索"
					disabled={draft.trim() === ""}
					icon={ArrowUp}
					size="small"
					variant="filled"
				/>
			</Example>
			<Example
				description="贴着内容边缘的关闭按钮用 outdent 抵掉方块多出的半圈，图标与标题右缘对齐。"
				title="详情头部的关闭"
			>
				<div className="flex w-full items-start justify-between gap-2">
					<div className="min-w-0">
						<p className="font-semibold text-base">候选人 A</p>
						<p className="text-fg-secondary text-xs">
							Talent 0123 · 后端工程师
						</p>
					</div>
					<ActionIcon
						aria-label="关闭详情"
						icon={X}
						outdent="end"
						title="关闭详情"
					/>
				</div>
			</Example>
			<Example
				description="压在滚动内容上的圆钮用 outlined 加 glass：半透明的浮层底糊掉底下的字，对话线程右下角回到最新就是它。"
				title="压在内容上"
			>
				<div className="relative h-28 w-full overflow-hidden rounded-md">
					<p className="p-3 text-fg-secondary text-sm">
						已按以下条件搜索：推荐系统、团队管理（加分）。「三年以上」按在大厂的累计时长算，满足的人排在前面。
					</p>
					<ActionIcon
						className="absolute end-4 bottom-4"
						glass
						icon={ArrowDown}
						style={{ borderRadius: "50%" }}
						title="跳转到最新"
						variant="outlined"
					/>
				</div>
			</Example>
			<Example
				description="收起的次要动作放进菜单，触发器用省略号图标。"
				title="更多操作"
			>
				<DropdownMenuRoot>
					<DropdownMenuTrigger>
						<ActionIcon aria-label="更多操作" icon={Ellipsis} />
					</DropdownMenuTrigger>
					<DropdownMenuPortal>
						<DropdownMenuPositioner>
							<DropdownMenuPopup>
								{renderDropdownMenuItems([
									{ key: "copy", label: "复制搜索条件" },
									{ key: "export", label: "导出名单" },
									{ type: "divider" },
									{ danger: true, key: "delete", label: "删除这次搜索" },
								])}
							</DropdownMenuPopup>
						</DropdownMenuPositioner>
					</DropdownMenuPortal>
				</DropdownMenuRoot>
			</Example>
		</ExampleGrid>
	);
}

/** 图标按钮：三种外观、激活态、几档尺寸。 */
export function ActionIconPage() {
	const sizeTier = useTier("action-icon");
	return (
		<DocPage
			facts={[
				`${VARIANTS.length} 种外观`,
				`${COMPONENT_TIERS["action-icon"].length} 种尺寸`,
				"激活态",
			]}
			rules={{
				notes: [
					"只有图标的按钮用 ActionIcon，不用 Button 只放图标。",
					"必须有名字：给 title 出悬停提示，或给 aria-label；菜单触发器没有 aria-label 时拿字符串 title 当名字。",
					"放在 Toolbar 里时经 ToolbarButton 的 render 交进去，方向键在按钮之间移动焦点。",
					"开关状态用 active，不另画选中装饰。",
					'尺寸用 size，不覆盖宽高与圆角；贴着行尾对齐用 outdent="end"，不写负外边距。',
					'栏顶页头（NavHeader）上的用 size="header"：28px 方块、16px 图标，正好填满页头去掉内边距的高度。',
				],
				usage: `<ActionIcon\n  icon={Trash2}\n  size="small"\n  title="删除这次搜索"\n/>`,
			}}
			sections={[
				{
					children: <Playground />,
					id: "playground",
					tag: sizeTier,
					title: "试用图标按钮",
				},
				{
					children: <Appearances />,
					id: "appearance",
					tag: sizeTier,
					title: "外观与状态",
				},
				{ children: <Sizes />, id: "sizes", title: "尺寸" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
