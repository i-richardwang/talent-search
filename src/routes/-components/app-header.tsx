import { Link } from "@tanstack/react-router";
import { UsersRoundIcon } from "lucide-react";
import type { RecentSearch } from "#/server/turn";
import { RecentPopover } from "./recent-popover";

/**
 * 顶栏。照 coss 文档站那条的配方来：整条吸顶、半透明的画布色加一层模糊，
 * 底边那条线是 `before:` 伪元素画的一根 `h-px`（`bg-border/64`），不是 `border-b`。
 * 这几样合起来才是这套系统的顶栏长相——内容从下面滑过去时能透出来一点，
 * 而那根线比一条实边框淡，不会在整屏顶上压出一道黑杠。
 *
 * 左右各一样东西：身份，和「最近」。这个应用只有一件事可做，中间那段留白就是
 * 它的信息量。
 *
 * 名字按正文号排，不放大：汉字系统字没有拉丁 display 字那种放大之后还成立的
 * 字形。它是一个回首页的链接，不是这一页的 h1——h1 在零态正中那处。
 */
export function AppHeader({ recent }: { recent: RecentSearch[] | null }) {
	return (
		<header className="sticky top-0 z-stick bg-canvas/80 backdrop-blur-sm before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border/64">
			<div className="app-column flex h-(--header-height) items-center gap-2">
				<Link
					className="flex items-center gap-2 font-heading font-semibold text-sm hover:text-primary"
					to="/"
				>
					<UsersRoundIcon className="size-4 text-muted-foreground" />
					人才搜索
				</Link>
				<div className="ms-auto flex items-center gap-2">
					<RecentPopover recent={recent} />
				</div>
			</div>
		</header>
	);
}
