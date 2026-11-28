import { createFileRoute } from "@tanstack/react-router";
import { pageParam } from "#/lib/paging";
import { loadPoolBoard } from "#/server/talent-functions";
import { AdminPage } from "../-components/admin-page";
import { PoolBoard } from "./-pool-board";
export const Route = createFileRoute("/pools")({
	validateSearch: (s: Record<string, unknown>) => ({
		page: pageParam(s.page),
		poolId: typeof s.poolId === "string" ? s.poolId : undefined,
		tab: s.tab === "imports" ? ("imports" as const) : undefined,
	}),
	loaderDeps: ({ search }) => ({
		pool: search.poolId,
		tab: search.tab ?? ("members" as const),
		page: search.page ?? 1,
	}),
	loader: ({ deps }) => loadPoolBoard({ data: deps }),
	component: Page,
});
function Page() {
	const board = Route.useLoaderData();
	return (
		<AdminPage title="外部人才池">
			<PoolBoard board={board} />
		</AdminPage>
	);
}
