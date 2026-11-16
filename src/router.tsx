import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { PageError } from "./routes/-components/dead-end";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	return createTanStackRouter({
		routeTree,
		defaultPreload: "intent",
		defaultErrorComponent: PageError,
	});
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
