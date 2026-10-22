import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { requireViewer, viewer } from "./access";

export const currentUser = createServerFn({ method: "GET" }).handler(() =>
	viewer(getRequestHeaders()),
);

export const authenticated = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		await requireViewer(getRequestHeaders());
		return next();
	},
);

export const administrator = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		await requireViewer(getRequestHeaders(), true);
		return next();
	},
);
