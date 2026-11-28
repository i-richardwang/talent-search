import {
	createFileRoute,
	Outlet,
	redirect,
	useParams,
} from "@tanstack/react-router";
import { pageParam } from "#/lib/paging";
import { excludedTable, termTable } from "#/server/functions";
import { AdminPage, useListPending } from "../-components/admin-page";
import { TermTable } from "./-components/term-table";
import { rejudge } from "./-lib/rejudge";

/**
 * 标签：此刻简历里有人写的短说法（能力词、外部岗位名）哪些写法归并成了同一个词、
 * 哪个词属于哪个更宽的词。点一个词看它的人数和上下从属（`/terms/$word`）。
 *
 * 词表由后台整理写（`src/corpus/vocabulary.ts`），一个词只判一次。管理员在这一页复查：
 * 多一张判成不是能力的词的表，看得到哪些词在等判定，判得不对的把那一项、那一支或整批
 * 退回重新判定。找词和翻页在服务端做，词、页码和看的是哪一张表写进地址。
 */
type TermSearch = {
	q: string;
	page: ReturnType<typeof pageParam>;
	/** 看判成不是能力的那张表，只有管理员有；看标签时地址上不写 */
	excluded?: true;
};

export const Route = createFileRoute("/terms")({
	beforeLoad: ({ context, search }) => {
		if (search.excluded && !context.user?.admin)
			throw redirect({
				search: { ...search, excluded: undefined },
				to: "/terms",
			});
	},
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
	loader: ({ deps: { excluded, ...query } }) =>
		(excluded ? excludedTable : termTable)({ data: query }),
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
