import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { pageParam } from "#/lib/paging";
import { termTable } from "#/server/functions";
import { AdminPage, useListPending } from "../-components/admin-page";
import { TermTable } from "./-components/term-table";

/**
 * 词表的管理页：简历里读出的短说法（能力词、做过的事、入职前岗位名）哪些写法归并成了
 * 同一个词、哪个词属于哪个更宽的词。点一个词看它的释义和上下从属（`/terms/$word`）。
 *
 * 只读：词表由后台整理自动写（`src/corpus/vocabulary.ts`），在这里改的下一轮就被覆盖；
 * 改结论走外部判定方提交。找词和翻页在服务端做，词和页码写进地址。
 */
export const Route = createFileRoute("/terms")({
	validateSearch: (search: Record<string, unknown>) => ({
		q: typeof search.q === "string" ? search.q : "",
		page: pageParam(search.page),
	}),
	loaderDeps: ({ search }) => ({ page: search.page, q: search.q }),
	loader: ({ deps }) => termTable({ data: { page: deps.page, q: deps.q } }),
	head: () => ({ meta: [{ title: "标签 · 人才搜索" }] }),
	component: Terms,
});

function Terms() {
	const table = Route.useLoaderData();
	const { q } = Route.useSearch();
	// 开着的是哪一个词。它是子路由的参数，所以宽松地取——没开详情时就是 undefined。
	const { word } = useParams({ strict: false });
	const pending = useListPending("/terms");

	return (
		<AdminPage title="标签">
			<TermTable q={q} selected={word} table={table} pending={pending} />
			{/* 点开的那个词从右侧覆盖（`terms/$word.tsx`），表在底下保持原样 */}
			<Outlet />
		</AdminPage>
	);
}
