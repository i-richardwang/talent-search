import { Code2, PanelLeft, Redo2, Save, Undo2, UsersRound } from "lucide-react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Button } from "#/components/ui/button";
import { Divider } from "#/components/ui/divider";
import { Tag } from "#/components/ui/tag";
import { href } from "../shared/routes";
import { NAV_DRAWER_ID } from "./navigation";

/** 顶栏：产品名与「设计系统」，右边是撤销、重做、保存方案与导出；窄屏多一个打开目录的按钮。 */
export function TopBar({
	canRedo,
	canUndo,
	navDrawerOpen,
	onExport,
	onOpenNav,
	onRedo,
	onSave,
	onUndo,
}: {
	canRedo: boolean;
	canUndo: boolean;
	navDrawerOpen: boolean;
	onExport: () => void;
	onOpenNav: () => void;
	onRedo: () => void;
	onSave: () => void;
	onUndo: () => void;
}) {
	return (
		<header className="flex h-16 shrink-0 items-center gap-5 border-border-secondary border-b bg-container px-6 max-sm:sticky max-sm:top-0 max-sm:z-stick max-sm:gap-1.5 max-sm:px-3">
			<ActionIcon
				aria-controls={NAV_DRAWER_ID}
				aria-expanded={navDrawerOpen}
				className="lg:hidden"
				icon={PanelLeft}
				onClick={onOpenNav}
				title="打开目录"
			/>
			<a
				className="flex items-center gap-2.5 whitespace-nowrap text-fg hover:text-fg"
				href={href.overview}
			>
				<span className="flex size-7 items-center justify-center rounded-md bg-primary text-container">
					<UsersRound className="size-4" />
				</span>
				<strong className="font-semibold text-lg tracking-tight max-sm:hidden">
					人才搜索
				</strong>
				<Divider className="max-sm:hidden" orientation="vertical" />
				<span className="text-fg-secondary text-sm max-sm:hidden">
					设计系统
				</span>
			</a>
			<Tag className="max-xl:hidden" size="small" variant="outlined">
				内部工具
			</Tag>
			<div className="ml-auto flex items-center gap-2 max-sm:gap-0.5">
				<ActionIcon
					disabled={!canUndo}
					icon={Undo2}
					onClick={onUndo}
					title="撤销"
				/>
				<ActionIcon
					disabled={!canRedo}
					icon={Redo2}
					onClick={onRedo}
					title="重做"
				/>
				<Divider className="max-sm:hidden" orientation="vertical" />
				<Button icon={Save} onClick={onSave}>
					<span className="max-md:hidden">保存方案</span>
				</Button>
				<Button icon={Code2} onClick={onExport} type="primary">
					<span className="max-md:hidden">导出修改</span>
				</Button>
			</div>
		</header>
	);
}
