import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { Empty } from "#/components/ui/empty";
import { termDetail } from "#/server/functions";
import { DetailDrawer } from "../-components/detail-drawer";
import { TermRecord } from "./-components/term-drawer";
import { rejudge } from "./-lib/rejudge";

/**
 * 一个能力词：往上属于谁，往下带着哪几支、各有多少人。
 * 父词和子词都是链接，换一个词是又看了一个词，进历史，后退原路退回去。
 */
export const Route = createFileRoute("/terms/$word")({
	loader: async ({ params }) => {
		const detail = await termDetail({ data: { word: params.word } });
		if (!detail) throw notFound();
		return detail;
	},
	component: Term,
	notFoundComponent: TermNotFound,
});

/** 关掉抽屉是回到刚才那张表，所以词和页码原样带回去。 */
function useClose() {
	const navigate = useNavigate();
	const search = Route.useSearch();
	return () => void navigate({ search, to: "/terms" });
}

function Term() {
	return (
		<TermRecord
			close={useClose()}
			rejudge={rejudge}
			term={Route.useLoaderData()}
		/>
	);
}

/** 地址上的词此刻没有人写：标签页只列有人写的词。 */
function TermNotFound() {
	return (
		<DetailDrawer close={useClose()} title={Route.useParams().word}>
			<Empty
				description="在表上方搜一下相近的写法。"
				title="现在没有人写这个词"
			/>
		</DetailDrawer>
	);
}
