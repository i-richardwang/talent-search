import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { pageParam } from "#/lib/paging";
import { skillTable } from "#/server/functions";
import { AdminPage, useListPending } from "../-components/admin-page";
import { SkillTable } from "./-components/skill-table";

/**
 * 技能词表的管理页：哪些写法认成了同一个词、哪个词属于哪个更宽的词。
 * 点一个词看它的释义和上下从属（`/skills/$word`）。
 *
 * 只读。整理是后台每天自动做的（`src/corpus/vocabulary.ts`），这一页存在的理由是让管理员
 * 看得见它在做什么——筛选栏「入职前技能」上一个词后面的人数，是几种写法加上它下面
 * 的词一起数的，这里能看到是哪几种、下面有谁。没有改的入口：改了下一轮灌库就被盖回去，
 * 一个会被静默撤销的编辑框比没有更糟。想改结论走判定那条路（外部判定方提交），不走这一页。
 *
 * 谁判的、队列里还有几组待判都不上屏：前者是库里的留痕（`skill_term.judge`），排查时查库；
 * 后者是整理任务自己的事，过程在任务台那张卡片的运行记录里。这一页只答「词表认了什么」，
 * 没有第二句话。
 *
 * 找词和翻页都在服务端做，和数据页同一个形状：词表是一千多行，全发到页面是三兆多的
 * HTML，而只在当前页里过滤的搜索框会给出错的总数。词和页码在地址里，所以某一页、
 * 某一次搜索可以直接发给别人。
 */
export const Route = createFileRoute("/skills")({
	validateSearch: (search: Record<string, unknown>) => ({
		q: typeof search.q === "string" ? search.q : "",
		page: pageParam(search.page),
	}),
	loaderDeps: ({ search }) => ({ page: search.page, q: search.q }),
	loader: ({ deps }) => skillTable({ data: { page: deps.page, q: deps.q } }),
	head: () => ({ meta: [{ title: "技能 · 人才搜索" }] }),
	component: Skills,
});

function Skills() {
	const table = Route.useLoaderData();
	const { q } = Route.useSearch();
	// 开着的是哪一个词。它是子路由的参数，所以宽松地取——没开详情时就是 undefined。
	const { word } = useParams({ strict: false });
	const pending = useListPending("/skills");

	return (
		<AdminPage title="技能">
			<SkillTable q={q} selected={word} table={table} pending={pending} />
			{/* 点开的那个词从右侧覆盖（`skills/$word.tsx`），表在底下保持原样 */}
			<Outlet />
		</AdminPage>
	);
}
