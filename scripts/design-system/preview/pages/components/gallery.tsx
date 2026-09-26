import { Search, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Alert } from "#/components/ui/alert";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { Empty } from "#/components/ui/empty";
import { Hotkey } from "#/components/ui/hotkey";
import { Input } from "#/components/ui/input";
import { Popover } from "#/components/ui/popover";
import { Radio, RadioGroup } from "#/components/ui/radio";
import { Segmented } from "#/components/ui/segmented";
import { Skeleton } from "#/components/ui/skeleton";
import { Tag } from "#/components/ui/tag";
import { Tooltip } from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";
import { useCurrentPage } from "../../state";

/** 一块总览卡片：左上是这一组叫什么，右上是用到的组件名。 */
function Card({
	children,
	className,
	name,
	title,
}: {
	children: ReactNode;
	className?: string;
	name: string;
	title: string;
}) {
	return (
		<Block
			className={cn("min-w-0", className)}
			gap={20}
			padding={20}
			variant="outlined"
		>
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="font-medium text-sm">{title}</h2>
				<span className="font-mono text-fg-tertiary text-xs">{name}</span>
			</div>
			{children}
		</Block>
	);
}

const SURFACES = [
	["bg-layout", "画布"],
	["bg-container", "卡片"],
	["bg-elevated", "浮层"],
	["bg-fill-tertiary", "填充"],
	["bg-fill-secondary", "悬停"],
	["bg-primary-bg", "选中"],
] as const;

/** 组件总览：常用组件在同一份令牌下放在一起看，改令牌时一眼看出整体的变化。 */
export function GalleryPage() {
	const { title } = useCurrentPage();
	const [mode, setMode] = useState("ai");
	return (
		<div className="mx-auto max-w-6xl p-8 max-md:p-6">
			<h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
			<div className="mt-8 grid grid-cols-2 gap-4 max-md:grid-cols-1">
				<Card className="col-span-full" name="Block" title="表面与层次">
					<div className="grid grid-cols-6 gap-2 max-md:grid-cols-3">
						{SURFACES.map(([className, label]) => (
							<div className="flex flex-col items-center gap-2" key={label}>
								<div
									className={cn(
										"flex h-12 w-full items-center justify-center rounded-md border border-border-secondary text-sm",
										className,
									)}
								>
									Aa
								</div>
								<span className="text-fg-secondary text-xs">{label}</span>
							</div>
						))}
					</div>
				</Card>
				<Card name="Button · ActionIcon" title="按钮">
					<div className="flex flex-wrap items-center gap-2">
						<Button type="primary">新建搜索</Button>
						<Button>导出名单</Button>
						<Button type="fill">保存为模板</Button>
						<Button type="text">清空</Button>
						<Button disabled>不可用</Button>
						<ActionIcon icon={Trash2} title="删除" />
					</div>
				</Card>
				<Card name="Input · Checkbox · Radio" title="输入与选择">
					<div className="flex flex-col gap-3">
						<Input
							aria-label="需求"
							placeholder="描述要找的人，比如做过支付风控的后端"
							prefix={<Search className="size-4 text-fg-tertiary" />}
						/>
						<div className="flex flex-wrap items-center justify-between gap-3">
							<Checkbox defaultChecked>只看在职</Checkbox>
							<RadioGroup
								aria-label="排序"
								className="flex gap-3"
								defaultValue="relevance"
							>
								<Radio value="relevance">按相关度</Radio>
								<Radio value="tenure">按年限</Radio>
							</RadioGroup>
						</div>
						<Segmented
							block
							onChange={setMode}
							options={[
								{ label: "AI 搜索", value: "ai" },
								{ label: "关键词搜索", value: "keyword" },
							]}
							value={mode}
						/>
					</div>
				</Card>
				<Card name="Tag · Alert" title="标签与提示">
					<div className="flex flex-col gap-3">
						<div className="flex flex-wrap gap-2">
							<Tag>后端</Tag>
							<Tag>支付</Tag>
							<Tag variant="outlined">五年以上</Tag>
						</div>
						<Alert title="人才库今天凌晨已同步。" type="info" />
						<Alert
							title="AI 服务暂时连不上，可以先用关键词搜索。"
							type="warning"
						/>
					</div>
				</Card>
				<Card name="Typography" title="文字层级">
					<div className="flex flex-col gap-2">
						<p className="font-semibold text-xl">支付风控 · 后端</p>
						<p className="text-sm">
							在两段经历里做过交易风控规则引擎，累计四年。
						</p>
						<p className="text-fg-secondary text-sm">后端工程师 · 基础平台部</p>
						<p className="text-fg-tertiary text-xs">简历自述 · 三天前更新</p>
					</div>
				</Card>
				<Card name="Tooltip · Popover · DropdownMenu" title="浮层">
					<div className="flex flex-wrap items-center gap-2">
						<Tooltip title="搜索">
							<Button icon={Search}>搜索</Button>
						</Tooltip>
						<Popover content="条件之间是「并且」，同一项里的取值是「或者」。">
							<Button>条件怎么组合</Button>
						</Popover>
						<DropdownMenuRoot>
							<DropdownMenuTrigger>
								<Button type="fill">导出</Button>
							</DropdownMenuTrigger>
							<DropdownMenuPortal>
								<DropdownMenuPositioner>
									<DropdownMenuPopup>
										{renderDropdownMenuItems([
											{ key: "csv", label: "导出为 CSV" },
											{ key: "xlsx", label: "导出为 Excel" },
										])}
									</DropdownMenuPopup>
								</DropdownMenuPositioner>
							</DropdownMenuPortal>
						</DropdownMenuRoot>
						<Hotkey keys="mod+enter" />
					</div>
				</Card>
				<Card name="Empty · Skeleton" title="空态与加载">
					<div className="grid grid-cols-2 gap-4">
						<Empty
							description="换个说法，或者去掉一个条件。"
							title="没有找到人"
						/>
						<div className="flex flex-col gap-3">
							<Skeleton.Text rows={3} />
						</div>
					</div>
				</Card>
			</div>
		</div>
	);
}
