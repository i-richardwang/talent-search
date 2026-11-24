import { createFileRoute } from "@tanstack/react-router";
import { readDeriveInputs, receiveDeriveResults } from "#/server/derive-api";
import { requestJob } from "#/server/jobs";

export const Route = createFileRoute("/api/derive")({
	server: {
		handlers: {
			GET: ({ request }) => readDeriveInputs(request),
			POST: ({ request }) =>
				receiveDeriveResults(request, () => requestJob({ kind: "derive" })),
		},
	},
});
