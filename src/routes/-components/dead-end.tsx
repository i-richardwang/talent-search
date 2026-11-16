import { Link, useRouter } from "@tanstack/react-router";
import {
	CloudAlertIcon,
	FileQuestionMarkIcon,
	type LucideIcon,
	RotateCwIcon,
	SearchXIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";
import { Icon } from "#/components/ui/icon";
import { PageHeader } from "./page-header";

/**
 * 这一屏打不开：页面不存在、记录不存在，或者取数据时出了错。都是一屏没有内容、给一两个
 * 下一步，共用这一屏，只有措辞、水印和按钮不同。它们都渲染在 `<Outlet />` 的位置上，
 * 所以页头和 `<main>` 由它自己给。
 */
function DeadEnd({
	icon,
	title,
	description,
	hint,
	retry,
}: {
	icon: LucideIcon;
	title: string;
	description: string;
	/** 说明的第二行：接下来可以怎么办。 */
	hint: string;
	/** 重来一次的按钮，排在「返回首页」前面；地址本身就不对时没有。 */
	retry?: ReactNode;
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
				<div className="flex gap-2">
					{retry}
					<Button render={<Link to="/" />} type={retry ? "default" : "primary"}>
						返回首页
					</Button>
				</div>
			</main>
		</>
	);
}

/** 没有任何路由匹配的地址（`__root.tsx` 的 `notFoundComponent`）。 */
export function PageNotFound() {
	return (
		<DeadEnd
			description="链接无效或页面已被移除。"
			hint="检查一下地址，或回到首页重新开始一次搜索。"
			icon={FileQuestionMarkIcon}
			title="页面不存在"
		/>
	);
}

/** 地址里的搜索记录不存在（`s/$turnId/route.tsx` 的 `notFoundComponent`）。 */
export function TurnNotFound() {
	return (
		<DeadEnd
			description="链接可能已失效，或记录已被删除。"
			hint="最近搜索里还留着的记录可以直接打开，或回到首页重新搜一次。"
			icon={SearchXIcon}
			title="这条搜索记录不存在"
		/>
	);
}

/**
 * 取这一屏的数据时出了错（router 的 `defaultErrorComponent`）：服务器或网络的事，地址没错，
 * 重新取一次多半就好。原错误只进服务端日志，不上屏。
 */
export function PageError() {
	const router = useRouter();
	return (
		<DeadEnd
			description="可能是网络或服务器的临时问题。"
			hint="重新加载一次试试；一直打不开请联系管理员。"
			icon={CloudAlertIcon}
			retry={
				<Button
					icon={RotateCwIcon}
					onClick={() => router.invalidate()}
					type="primary"
				>
					重新加载
				</Button>
			}
			title="这一页没能打开"
		/>
	);
}
