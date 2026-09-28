import { Link } from "@tanstack/react-router";
import { FileQuestionIcon, type LucideIcon, SearchXIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Icon } from "#/components/ui/icon";
import { PageHeader } from "./page-header";

/**
 * 地址指向的东西不存在：页面不存在和记录不存在都是一条死链、一个出路，共用这一屏，
 * 只有措辞和水印不同。两个 `notFoundComponent` 都渲染在 `<Outlet />` 的位置上，
 * 所以页头和 `<main>` 由它自己给。
 */
function NotFound({
	icon,
	title,
	description,
	hint,
}: {
	icon: LucideIcon;
	title: string;
	description: string;
	/** 说明的第二行：接下来可以怎么办。 */
	hint: string;
}) {
	return (
		<>
			<PageHeader title={null} />
			<main
				className="flex flex-1 flex-col items-center justify-center px-6 pb-11"
				id="main"
				tabIndex={-1}
			>
				<Icon className="text-fg-tertiary" icon={icon} size={64} />
				<h1 className="mt-5 mb-4 text-center font-bold text-fg text-xl">
					{title}
				</h1>
				<div className="mb-7 text-center text-fg">
					<p className="m-0">{description}</p>
					<p className="m-0 mt-2">{hint}</p>
				</div>
				<Button render={<Link to="/" />} type="primary">
					返回首页
				</Button>
			</main>
		</>
	);
}

/** 根路由接不住的地址（`__root.tsx` 的 `notFoundComponent`）。 */
export function PageNotFound() {
	return (
		<NotFound
			description="链接无效或页面已被移除。"
			hint="检查一下地址，或回到首页重新开始一次搜索。"
			icon={FileQuestionIcon}
			title="页面不存在"
		/>
	);
}

/** 地址里的搜索记录不存在（`s/$turnId/route.tsx` 的 `notFoundComponent`）。 */
export function TurnNotFound() {
	return (
		<NotFound
			description="链接可能已失效，或记录已被删除。"
			hint="最近搜索里还留着的记录可以直接打开，或回到首页重新搜一次。"
			icon={SearchXIcon}
			title="这条搜索记录不存在"
		/>
	);
}
