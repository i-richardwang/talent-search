import { createFileRoute } from "@tanstack/react-router";
import { handleAuth } from "#/server/auth";

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: ({ request }) => handleAuth(request),
			POST: ({ request }) => handleAuth(request),
		},
	},
});
