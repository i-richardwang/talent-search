import { createFileRoute } from "@tanstack/react-router";
import { handleCorpusMcp } from "#/server/corpus-mcp-http";

export const Route = createFileRoute("/api/mcp/$scope")({
	server: {
		handlers: {
			POST: ({ request, params }) => handleCorpusMcp(request, params.scope),
			GET: ({ request, params }) => handleCorpusMcp(request, params.scope),
			DELETE: ({ request, params }) => handleCorpusMcp(request, params.scope),
		},
	},
});
