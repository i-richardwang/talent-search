import { createFileRoute } from "@tanstack/react-router";
import { requireViewer } from "#/server/access";
import { pendingResumeResponse } from "#/server/resume-files";
export const Route = createFileRoute("/api/resumes/pending/$task")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const user = await requireViewer(request.headers);
				return pendingResumeResponse(user.id, params.task);
			},
		},
	},
});
