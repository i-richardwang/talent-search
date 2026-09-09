import type { ReactNode } from "react";

/**
 * 三个管理页（`/data`、`/skills`、`/tasks`）共用的一屏：版心、抬头、内容。
 *
 * 它们和检索那两屏不是一类东西——没有查询、没有名单、没有详情栏，只有一个标题
 * 和一块内容。三处各写一遍 `app-column ... py-8` 加一个 `title-1` 的话，改一次
 * 上边距就会有一处忘掉，而忘掉的表现是顶栏底下那道空白在三个页面之间差几个
 * 像素——没人会把它当 bug 报上来。
 *
 * **标题底下不挂概述。** 那一句原本写的是「有多少人、还剩多少段、上次整理是什么
 * 时候」，而这三个数下面的表和卡片本来就在说——同一份数据画两遍，而且抬头那份
 * 还得自己再算一次。数归它该待的地方：表脚说这张表到哪为止，卡片说自己那一栏。
 */
export function AdminPage({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<main
			className="app-column flex flex-1 flex-col gap-6 py-8"
			id="main"
			tabIndex={-1}
		>
			<h1 className="title-1 font-semibold">{title}</h1>
			{children}
		</main>
	);
}
