import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { pageParam } from "#/lib/paging";
import { termTable } from "#/server/functions";
import { AdminPage, useListPending } from "../-components/admin-page";
import { TermTable } from "./-components/term-table";
import { rejudge } from "./-lib/rejudge";

/**
 * 词表的管理页：简历里读出的短说法（能力词、入职前岗位名）哪些写法归并成了
 * 同一个词、哪个词属于哪个更宽的词，以及哪些词被判成不是能力。点一个词看它的人数和
 * 上下从属（`/terms/$word`）。
 *
 * 词表由后台整理写（`src/corpus/vocabulary.ts`），一个词只判一次；这一页是人复查的地方，
 * 看到判得不对的，管理员把那一项、那一支或整批退回重新判定。找词和翻页在服务端做，
 * 词、页码和看的是哪一张表写进地址。
 */
type TermSearch = {
	q: string;
	page: ReturnType<typeof pageParam>;
	/** 看判成不是能力的那张表；看标签时地址上不写 */
	excluded?: true;
};

export const Route = createFileRoute("/terms")({
	validateSearch: (search: Record<string, unknown>): TermSearch => ({
		q: typeof search.q === "string" ? search.q : "",
		page: pageParam(search.page),
		...(search.excluded === true && { excluded: true }),
	}),
	loaderDeps: ({ search }) => ({
		excluded: search.excluded ?? false,
		page: search.page,
		q: search.q,
	}),
	loader: ({ deps }) => termTable({ data: deps }),
	head: () => ({ meta: [{ title: "标签 · 人才搜索" }] }),
	component: Terms,
});

function Terms() {
	const table = Route.useLoaderData();
	const { q, excluded = false } = Route.useSearch();
	const { user } = Route.useRouteContext();
	// 开着的是哪一个词。它是子路由的参数，所以宽松地取——没开详情时就是 undefined。
	const { word } = useParams({ strict: false });
	const pending = useListPending("/terms");

	return (
		<AdminPage title="标签">
			<TermTable
				excluded={excluded}
				pending={pending}
				q={q}
				rejudge={user?.admin ? rejudge : undefined}
				selected={word}
				table={table}
			/>
			{/* 点开的那个词从右侧覆盖（`terms/$word.tsx`），表在底下保持原样 */}
			<Outlet />
		</AdminPage>
	);
}
