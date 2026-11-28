import { createFileRoute } from "@tanstack/react-router";
import { pageParam } from "#/lib/paging";
import { loadImports } from "#/server/talent-functions";
import { AdminPage } from "../-components/admin-page";
import { PoolBoard } from "./-pool-board";
export const Route = createFileRoute("/pools")({
	validateSearch: (s: Record<string, unknown>) => ({ page: pageParam(s.page) }),
	loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
	loader: ({ deps }) => loadImports({ data: deps }),
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
