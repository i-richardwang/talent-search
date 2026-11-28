import { createFileRoute } from "@tanstack/react-router";
import { requireViewer } from "#/server/access";
import { resumeResponse } from "#/server/resume-files";
export const Route = createFileRoute("/api/resumes/$source")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const user = await requireViewer(request.headers);
				return resumeResponse(
					user.id,
					params.source,
					new URL(request.url).searchParams.has("download"),
				);
			},
		},
	},
});
