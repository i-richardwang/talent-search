import { Link } from "@tanstack/react-router";
import {
	segmentedControlItemVariants,
	segmentedControlRootClassName,
} from "#/lib/segmented-control";

const item = segmentedControlItemVariants({ state: "current" });

/**
 * 两种搜索的切换：对话和关键词，摆在首页输入面的上方。
 *
 * 两种各是一个起点，切过去是从头开一次新的搜索，所以它们是两个链接，不是一组
 * Tabs——coss 的分段控件文档把「去另一个地址」分给导航链接，Tabs 留给同一页里
 * 切面板。当前那个由 TanStack Router 的 `Link` 自己判定并写上 `aria-current="page"`，
 * 分段样式的 `current` 档读的就是它；`exact` 让地址参数整份相等才算当前，
 * 否则不带参数的「对话」在任何首页地址上都算匹配。
 */
export function ModeNav() {
	return (
		<nav aria-label="搜索方式">
			<div className={segmentedControlRootClassName}>
				<Link
					activeOptions={{ exact: true }}
					className={item}
					search={{}}
					to="/"
				>
					AI 搜索
				</Link>
				<Link
					activeOptions={{ exact: true }}
					className={item}
					search={{ mode: "keyword" }}
					to="/"
				>
					关键词搜索
				</Link>
			</div>
		</nav>
	);
}
