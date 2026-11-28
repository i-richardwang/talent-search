import "@tanstack/react-start/server-only";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import {
	getDocument,
	type PDFPageProxy,
	VerbosityLevel,
} from "pdfjs-dist/legacy/build/pdf.mjs";

const root = dirname(
	createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
);
type Canvas = {
	canvas: HTMLCanvasElement & { toBuffer: (type: "image/png") => Buffer };
};
type Factory = {
	create: (width: number, height: number) => Canvas;
	destroy: (canvas: Canvas) => void;
};

export async function openResumePdf(bytes: Uint8Array) {
	const task = getDocument({
		data: Uint8Array.from(bytes),
		verbosity: VerbosityLevel.ERRORS,
		standardFontDataUrl: join(root, "standard_fonts") + sep,
		cMapUrl: join(root, "cmaps") + sep,
		wasmUrl: join(root, "wasm") + sep,
		maxImageSize: 16_000_000,
		useSystemFonts: false,
		useWorkerFetch: false,
		stopAtErrors: true,
	});
	try {
		const doc = await task.promise;
		if (doc.numPages > 120) throw new Error("每份简历最多支持 120 页");
		async function usePage<T>(
			number: number,
			read: (page: PDFPageProxy) => Promise<T>,
		) {
			const page = await doc.getPage(number);
			try {
				return await read(page);
			} finally {
				page.cleanup();
			}
		}
		return {
			pageCount: doc.numPages,
			readPageText: (number: number) =>
				usePage(number, async (page) => {
					const content = await page.getTextContent();
					return content.items
						.flatMap((item) =>
							"str" in item ? [item.str + (item.hasEOL ? "\n" : " ")] : [],
						)
						.join("")
						.trim();
				}),
			renderPagePng: (number: number) =>
				usePage(number, async (page) => {
					const original = page.getViewport({ scale: 1 });
					const viewport = page.getViewport({
						scale: Math.min(
							2,
							2048 / Math.max(original.width, original.height),
						),
					});
					const factory = doc.canvasFactory as Factory;
					const surface = factory.create(
						Math.ceil(viewport.width),
						Math.ceil(viewport.height),
					);
					try {
						await page.render({ canvas: surface.canvas, viewport }).promise;
						return surface.canvas.toBuffer("image/png");
					} finally {
						factory.destroy(surface);
					}
				}),
			close: () => task.destroy(),
		};
	} catch (error) {
		await task.destroy();
		throw error;
	}
}
