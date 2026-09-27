import { Link } from "@tanstack/react-router";
import { SearchXIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Empty } from "#/components/ui/empty";
import { PageHeader } from "./page-header";

/**
 * 走到头了：地址指向的东西不存在。页面不存在与记录不存在是同一件事——一条死链，
 * 一个出路——所以它们共用这一个组件，两处只有措辞不同。
 *
 * 它整个就是一屏（两个 `notFoundComponent` 都渲染在 `<Outlet />` 的位置上），
 * 所以页头和 `<main>` 由它自己给。空态在内容卡片里 `flex-1` 并纵向居中，
 * 占满页头以下剩的高度。标题是这一屏的 h1。
 */
function NotFound({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<>
			<PageHeader title={null} />
			<main className="flex flex-1 flex-col" id="main" tabIndex={-1}>
				{/* 出路只有一条，所以它是个按钮不是一行小字：这一屏上没有别的可点。 */}
				<Empty
					action={<Button render={<Link to="/" />}>开始一次新搜索</Button>}
					className="flex-1 justify-center"
					description={description}
					icon={SearchXIcon}
					title={title}
					titleProps={{ as: "h1" }}
				/>
			</main>
		</>
	);
}

/** 根路由接不住的地址（`__root.tsx` 的 `notFoundComponent`）。 */
export function PageNotFound() {
	return <NotFound description="链接无效或页面已被移除。" title="页面不存在" />;
}

/** 地址里的搜索记录不存在（`s/$turnId/route.tsx` 的 `notFoundComponent`）。 */
export function TurnNotFound() {
	return (
		<NotFound
			description="链接可能已失效，或记录已被清理。"
			title="这条搜索记录不存在"
		/>
	);
}
