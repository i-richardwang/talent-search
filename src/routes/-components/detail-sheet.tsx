import { type ReactNode, useEffect, useState } from "react";
import {
	Sheet,
	SheetHeader,
	SheetPanel,
	SheetPopup,
	SheetTitle,
} from "#/components/ui/sheet";

/**
 * 管理页的详情抽屉：一张表在底下保持原样，被点开的那一行从右侧覆盖上来。
 *
 * 数据页点一个人（`data.$empId.tsx`）和技能页点一个词（`skills.$word.tsx`）用的是
 * 同一件东西——管数据的人是顺着表往下看的，看一个、回到表、再看下一个；跳页的话
 * 每次返回表格都已经滚回顶部。
 *
 * 开合是路由说了算（地址栏里有那个 id，这一层就在开着），但动画得由组件自己走完：
 * 关的时候先把 `open` 落下去让它滑回右边，滑完了（`onOpenChangeComplete`）才由
 * `close` 导航回列表——直接导航的话这一层是被卸掉的，不是滑走的。开也同理：挂上来
 * 的时候是开着的就没有起始态可言，所以先挂成关的，紧接着这一帧再打开。
 *
 * 回哪里由调用方给：各自的列表带着各自要原样带回去的地址栏参数（数据页是词和页码），
 * 这一层不认识它们。
 */
export function DetailSheet({
	className,
	close,
	title,
	description,
	children,
}: {
	/** 覆盖抽屉的宽度；内容一行放不下几个字的页面给到宽的那一档 */
	className?: string;
	/** 滑回右边之后往哪走 */
	close: () => void;
	title: ReactNode;
	description?: ReactNode;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	useEffect(() => setOpen(true), []);
	return (
		<Sheet
			onOpenChange={setOpen}
			onOpenChangeComplete={(opened) => {
				if (!opened) close();
			}}
			open={open}
		>
			<SheetPopup className={className}>
				<SheetHeader>
					<SheetTitle>{title}</SheetTitle>
					{description}
				</SheetHeader>
				<SheetPanel className="flex flex-col gap-4">{children}</SheetPanel>
			</SheetPopup>
		</Sheet>
	);
}

/**
 * 抽屉里事实网格的一行，标签一栏、内容一栏。整个网格的列由外面那个
 * `grid-cols-[auto_1fr]` 给，所以这里出的是一对 `dt`/`dd`，不是一个盒子——
 * 两栏各自对齐靠的是同一个网格，一行一个盒子的话，标签栏就对不齐了。
 *
 * 标签用 `label` 那一档字号：12px 配次要色的话，标签和内容完全一样，两栏之间
 * 就只剩缩进来区分。检索那边的详情面板另有一份两栏卡片式的事实网格
 * （`s/$turnId/p.$empId.tsx`），那是一屏常驻的档案头，和这里一行一条的读法不是
 * 一回事，没有并成一个。
 */
export function Fact({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<>
			<dt className="label text-muted-foreground">{label}</dt>
			<dd className="whitespace-pre-wrap">{children}</dd>
		</>
	);
}
