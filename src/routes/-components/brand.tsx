import { Link } from "@tanstack/react-router";
import { UsersRoundIcon } from "lucide-react";

/**
 * 身份。零态和工作台共用，所以只有一份——两屏各写一遍的话，
 * 图标粗细、间距、字号迟早会在某一次改动里分家。
 *
 * 标记不占色相。coss 是一套中性色系统，`--primary` 在浅色下就是 neutral-800，
 * 它是「最重的前景色」，不是一个品牌色。而绿（受控命中）、蓝（选中）、
 * amber（提示）三个色相各自已经有主，谁都不该被挪来当身份标记。
 */
export function Brand() {
	return (
		<Link
			className="flex shrink-0 items-center gap-2 text-foreground no-underline"
			to="/"
		>
			<UsersRoundIcon className="size-5" strokeWidth={1.75} />
			{/* 这一页的 h1。详情面板上那个姓名是页面里的一节，不是整页的标题。 */}
			<h1 className="font-semibold text-base">人才搜索</h1>
		</Link>
	);
}
