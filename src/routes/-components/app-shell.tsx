import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";
import type { RecentSearch } from "#/server/turn";
import { AppHeader } from "./app-header";
import { PageFrame } from "./page-frame";

/**
 * 每一屏共用的外壳：跳到正文的链接、页框、顶栏，下面接这一屏的内容。
 * `recent` 是顶栏历史弹层里的搜索记录，取不到时是 `null`。
 */
export function AppShell({
	recent,
	children,
}: {
	recent: RecentSearch[] | null;
	children: ReactNode;
}) {
	return (
		<div className="relative isolate flex flex-1 flex-col overflow-clip">
			<div className="fixed top-2 left-2 z-escape not-focus-within:sr-only">
				<Button render={<a href="#main" />} size="small">
					跳到正文
				</Button>
			</div>
			<PageFrame />
			<AppHeader recent={recent} />
			{children}
		</div>
	);
}
