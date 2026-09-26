import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { Empty } from "#/components/ui/empty";
import { skillTerm } from "#/server/functions";
import { TermDrawer, TermRecord } from "./-components/term-drawer";

/**
 * 一个能力词：它是什么意思，往上属于谁，往下带着谁。
 *
 * 表上那两列只说得下往上属于谁、往下有几项，具体是哪几项在这里：筛选栏上「数据分析」
 * 后面的人数是几支合起来的，这一层一眼看得见是哪几支、各有多少人。
 *
 * 父词和子词都是链接，点了就换成那个词：从属关系是一棵树，顺着往上往下走是读这棵树
 * 唯一的读法。走过的每一步都进历史，后退原路退回去——换一个词不是「换当前选中项」，
 * 是又看了一个词。
 *
 * 只读，同 `/skills`：整理是后台每天自动做的，改了下一轮灌库就被盖回去。
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
		<TermDrawer close={useClose()} title="没有这个词">
			<Empty
				description="它可能是上一轮整理并进了别的词，也可能还没被整理到。"
				title="词表里没有这个词"
			/>
		</TermDrawer>
	);
}
