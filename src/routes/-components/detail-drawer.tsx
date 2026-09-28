import { type ReactNode, useState } from "react";
import { Drawer } from "#/components/ui/drawer";
import { Text } from "#/components/ui/text";

/** 管理页详情里属性列表的标签栏宽度（px），几种详情之间看着一样。 */
export const DETAIL_LABEL_WIDTH = 96;

/**
 * 管理页的详情抽屉：表在底下保持原样，点开的那一行从右侧覆盖上来。管数据的人顺着表
 * 往下看，跳页的话每次返回表格都已经滚回顶部。
 *
 * 开合由路由决定：挂上时滑进来；关的时候先落下 `open` 让它滑走，滑完（`afterClose`）
 * 才由 `close` 导航回列表——直接导航的话这一层是被卸掉的，不是滑走的。
 */
export function DetailDrawer({
	width,
	extra,
	close,
	title,
	description,
	children,
}: {
	/** 不给是 `Drawer` 的详情档 */
	width?: string;
	extra?: ReactNode;
	/** 滑走之后往哪走，带着列表要原样带回去的地址参数 */
	close: () => void;
	title: ReactNode;
	/** 排在正文最前 */
	description?: ReactNode;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(true);
	return (
		<Drawer
			afterClose={close}
			extra={extra}
			onClose={() => setOpen(false)}
			open={open}
			title={title}
			width={width}
		>
			<div className="flex flex-col gap-6">
				{description}
				{children}
			</div>
		</Drawer>
	);
}

/** 详情正文里带计数的一节，例如「入职前 3 段」「细分 12 项」。 */
export function DetailSection({
	title,
	count,
	children,
}: {
	title: string;
	count: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-2">
			<h3 className="flex items-baseline gap-1.5">
				<Text size="sm" type="secondary" weight="medium">
					{title}
				</Text>
				<Text size="xs" type="quaternary">
					{count}
				</Text>
			</h3>
			{children}
		</section>
	);
}
