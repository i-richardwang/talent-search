import "@tanstack/react-start/server-only";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import {
	getDocument,
	type PDFPageProxy,
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

async function recognize(page: PDFPageProxy, factory: Factory, bin: string) {
	const original = page.getViewport({ scale: 1 });
	const scale = Math.min(2, 2048 / Math.max(original.width, original.height));
	const viewport = page.getViewport({ scale });
	const surface = factory.create(
		Math.ceil(viewport.width),
		Math.ceil(viewport.height),
	);
	try {
		await page.render({ canvas: surface.canvas, viewport }).promise;
		const png = surface.canvas.toBuffer("image/png");
		return await new Promise<string>((resolve, reject) => {
			const child = execFile(
				bin,
				["stdin", "stdout", "-l", process.env.RESUME_OCR_LANG || "chi_sim+eng"],
				{ timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
				(err, out) =>
					err
						? reject(new Error("本地 OCR 未能读取该页"))
						: resolve(out.trim()),
			);
			child.stdin?.on("error", () => {});
			child.stdin?.end(png);
		});
	} finally {
		factory.destroy(surface);
	}
}
export async function pdfPages(bytes: Uint8Array) {
	const task = getDocument({
		data: Uint8Array.from(bytes),
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
		const pages: string[] = [];
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await doc.getPage(n);
			try {
				const content = await page.getTextContent();
				let text = content.items
					.flatMap((item) =>
						"str" in item ? [item.str + (item.hasEOL ? "\n" : " ")] : [],
					)
					.join("")
					.trim();
				if (!text) {
					const bin = process.env.RESUME_OCR_BIN?.trim();
					if (!bin)
						throw new Error(
							"扫描件缺少文字，请上传可选取文字的 PDF 或手动填写档案",
						);
					text = await recognize(page, doc.canvasFactory as Factory, bin);
				}
				pages.push(text);
			} finally {
				page.cleanup();
			}
		}
		return pages;
	} finally {
		await task.destroy();
	}
}
