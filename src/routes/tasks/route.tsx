import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { TASK_KINDS } from "#/db/schema";
import { pageParam } from "#/lib/paging";
import { tasksStatus } from "#/server/functions";
import type { TaskPages } from "#/server/tasks";
import { AdminPage } from "../-components/admin-page";
import { TaskBoard } from "./-components/task-board";

export const Route = createFileRoute("/tasks")({
	validateSearch: (search: Record<string, unknown>): TaskPages => {
		const pages: TaskPages = {};
		for (const kind of TASK_KINDS) {
			const page = pageParam(search[kind]);
			if (page) pages[kind] = page;
		}
		return pages;
	},
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) => tasksStatus({ data: deps }),
	head: () => ({ meta: [{ title: "任务 · 人才搜索" }] }),
	component: Tasks,
});

const POLL_BUSY_MS = 2000;
const POLL_IDLE_MS = 10_000;

function Tasks() {
	const { corpus, judge, lanes, running } = Route.useLoaderData();
	const router = useRouter();

	useEffect(() => {
		const timer = setInterval(
			() => void router.invalidate(),
			running ? POLL_BUSY_MS : POLL_IDLE_MS,
		);
		return () => clearInterval(timer);
	}, [running, router]);

	return (
		<AdminPage title="任务">
			<TaskBoard
				busy={running}
				corpus={corpus}
				judge={judge}
				lanes={lanes}
				onDone={() => router.invalidate()}
			/>
		</AdminPage>
	);
}
