import { type ReactNode, useState } from "react";
import { Drawer } from "#/components/ui/drawer";

/**
 * 管理页的详情抽屉：一张表在底下保持原样，被点开的那一行从右侧覆盖上来。
 *
 * 数据页点一个人（`data/$empId.tsx`）和技能页点一个词（`skills/$word.tsx`）用的是
 * 同一件东西——管数据的人是顺着表往下看的，看一个、回到表、再看下一个；跳页的话
 * 每次返回表格都已经滚回顶部。
 *
 * 开合是路由说了算（地址栏里有那个 id，这一层就挂着），挂上时滑进来；关的时候先把
 * `open` 落下去让它滑回右边，滑完了（`afterClose`）才由 `close` 导航回
 * 列表——直接导航的话这一层是被卸掉的，不是滑走的。
 *
 * 回哪里由调用方给：各自的列表带着各自要原样带回去的地址栏参数（数据页是词和页码），
 * 这一层不认识它们。
 *
 * 正文是上下几节，节与节之间 24px；`description` 是最前面的一节。
 */
export function DetailDrawer({
	width,
	extra,
	close,
	title,
	description,
	children,
}: {
	/** 抽屉的宽度，不给是 `Drawer` 的详情档；内容一行放不下几个字的页面给到宽的那一档 */
	width?: string;
	/** 头部右侧、关闭按钮左边的动作，例如复制工号 */
	extra?: ReactNode;
	/** 滑回右边之后往哪走 */
	close: () => void;
	title: ReactNode;
	/** 标题下面那几行说明，排在正文最前 */
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
