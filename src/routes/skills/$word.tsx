import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { Empty } from "#/components/ui/empty";
import { skillTerm } from "#/server/functions";
import { DetailDrawer } from "../-components/detail-drawer";
import { TermRecord } from "./-components/term-drawer";

/**
 * 一个能力词：它是什么意思，往上属于谁，往下带着哪几支、各有多少人。
 * 父词和子词都是链接，换一个词是又看了一个词，进历史，后退原路退回去。
 */
export const Route = createFileRoute("/skills/$word")({
	loader: async ({ params }) => {
		const detail = await skillTerm({ data: { word: params.word } });
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
	return () => void navigate({ search, to: "/skills" });
}

function Term() {
	return <TermRecord close={useClose()} term={Route.useLoaderData()} />;
}

function TermNotFound() {
	return (
		<DetailDrawer close={useClose()} title="没有这个词">
			<Empty
				description="它可能是上一轮整理并进了别的词，也可能还没被整理到。"
				title="词表里没有这个词"
			/>
		</DetailDrawer>
	);
}
