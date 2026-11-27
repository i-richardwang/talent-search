import "@tanstack/react-start/server-only";
import { hostHeaderValidationResponse } from "@modelcontextprotocol/server";
import { createCorpusMcp } from "./corpus-mcp";
import { rejectDerive } from "./derive-api";
import { requestJob } from "./jobs";
import { rejectReview } from "./review";

const derive = createCorpusMcp("derive", {
	schedule: () => requestJob({ kind: "derive" }),
});
const review = createCorpusMcp("review", {
	schedule: () => requestJob({ kind: "review" }),
});

export async function handleCorpusMcp(
	request: Request,
	scope: string,
): Promise<Response> {
	if (scope !== "derive" && scope !== "review")
		return new Response(null, { status: 404 });
	const denied =
		scope === "derive" ? rejectDerive(request) : rejectReview(request);
	if (denied?.status === 404) return denied;
	const base = process.env.BETTER_AUTH_URL;
	if (!base) throw new Error("BETTER_AUTH_URL 未配置");
	const origin = new URL(base);
	const badHost = hostHeaderValidationResponse(request, [origin.hostname]);
	if (badHost) return badHost;
	const from = request.headers.get("origin");
	if (from !== null && from !== origin.origin)
		return new Response(null, { status: 403 });
	if (denied) {
		denied.headers.set(
			"WWW-Authenticate",
			`Bearer realm="talent-search-${scope}"`,
		);
		return denied;
	}
	return (scope === "derive" ? derive : review).fetch(request);
}
