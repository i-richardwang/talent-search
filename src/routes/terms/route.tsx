import {
	createFileRoute,
	Outlet,
	redirect,
	useParams,
} from "@tanstack/react-router";
import { pageParam } from "#/lib/paging";
import { termTable } from "#/server/functions";
import { AdminPage, useListPending } from "../-components/admin-page";
import { TermTable } from "./-components/term-table";
import { rejudge } from "./-lib/rejudge";

/**
 * 标签的管理页：此刻简历里有人写的短说法（能力词、入职前岗位名）哪些写法归并成了
 * 同一个词、哪个词属于哪个更宽的词，以及哪些词被判成不是能力。点一个词看它的人数和
 * 上下从属（`/terms/$word`）。
 *
 * 词表由后台整理写（`src/corpus/vocabulary.ts`），一个词只判一次；这一页是管理员复查的
 * 地方，看到判得不对的，把那一项、那一支或整批退回重新判定。HR 碰到标签的地方在工作流里：
 * 名单上方的技能筛选和关键词搜索的候选词。找词和翻页在服务端做，词、页码和看的是哪一张表
 * 写进地址。
 */
type TermSearch = {
	q: string;
	page: ReturnType<typeof pageParam>;
	/** 看判成不是能力的那张表；看标签时地址上不写 */
	excluded?: true;
};

export const Route = createFileRoute("/terms")({
	beforeLoad: ({ context }) => {
		if (!context.user?.admin) throw redirect({ to: "/" });
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
	loader: ({ deps }) => termTable({ data: deps }),
	head: () => ({ meta: [{ title: "标签 · 人才搜索" }] }),
	component: Terms,
});

function Terms() {
	const table = Route.useLoaderData();
	const { q, excluded = false } = Route.useSearch();
	// 开着的是哪一个词。它是子路由的参数，所以宽松地取——没开详情时就是 undefined。
	const { word } = useParams({ strict: false });
	const pending = useListPending("/terms");

	return (
		<AdminPage title="标签">
			<TermTable
				excluded={excluded}
				pending={pending}
				q={q}
				rejudge={rejudge}
				selected={word}
				table={table}
			/>
			{/* 点开的那个词从右侧覆盖（`terms/$word.tsx`），表在底下保持原样 */}
			<Outlet />
		</AdminPage>
	);
}
