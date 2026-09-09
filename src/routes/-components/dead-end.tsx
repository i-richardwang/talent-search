import { Link } from "@tanstack/react-router";
import { SearchXIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#/components/ui/empty";

/**
 * 走到头了：地址指向的东西不存在。页面不存在与记录不存在是同一件事——一条死链，
 * 一个出路——所以它们共用这一个组件，两处只有措辞不同。
 *
 * 它整个就是一屏（两个 `notFoundComponent` 都渲染在 `<Outlet />` 的位置上），
 * 所以 `<main>` 由它自己给——外壳只给顶栏和页框，正文是哪一块由每一屏说。
 * 高度交给 `Empty` 自带的 `flex-1`：在外壳这根竖列里，那就是「把顶栏以下剩的
 * 高度占满并居中」，不需要任何视口高度的算式。
 */
export function DeadEnd({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<main className="flex flex-1 flex-col" id="main" tabIndex={-1}>
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<SearchXIcon />
					</EmptyMedia>
					<EmptyTitle>{title}</EmptyTitle>
					<EmptyDescription>{description}</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					{/* 出路只有一条，所以它是个按钮不是一行小字：这一屏上没有别的可点。 */}
					<Button render={<Link to="/" />} size="sm" variant="outline">
						开始一次新搜索
					</Button>
				</EmptyContent>
			</Empty>
		</main>
	);
}
