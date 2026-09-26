/**
 * 设计系统的每一页在预览页里都渲染得出来；带页头的页，页头就是目录里写的标题
 * （组件页后面跟导出名），导出名是源文件里真实的导出。图标页的产品图标词表和页面
 * 代码对得上。只跑服务端渲染，不跑浏览器里的副作用。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PAGES } from "../scripts/design-system/preview/pages";
import { PRODUCT_ICONS } from "../scripts/design-system/preview/pages/foundations/icons";
import { PreviewStateContext } from "../scripts/design-system/preview/state";
import {
	catalog,
	isPreviewPage,
} from "../scripts/design-system/shared/catalog";
import { previewState } from "./design-system-state";

const text = (html: string) => html.replace(/<[^>]*>/g, "");

describe("预览页", () => {
	for (const page of catalog.flatMap((module) =>
		module.pages.filter(isPreviewPage),
	)) {
		const header = page.module.content === "document";
		test(
			header ? `${page.title}：页头是目录里的标题` : `${page.title}：画得出来`,
			() => {
				const Page = PAGES[page.id];
				const html = renderToStaticMarkup(
					<PreviewStateContext value={previewState(page.id)}>
						<Page />
					</PreviewStateContext>,
				);
				if (!header) {
					assert.ok(html.length > 0);
					return;
				}
				const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";
				assert.equal(text(heading), `${page.title}${page.name ?? ""}`);
			},
		);
	}
});

describe("导出名", () => {
	test("每页的导出名都是它源文件里的导出；没写源文件的页在组件库里找", async () => {
		const root = resolve(import.meta.dirname, "..");
		const library = readdirSync(resolve(root, "src/components/ui"))
			.filter((file) => file.endsWith(".tsx"))
			.map((file) => `src/components/ui/${file}`);
		for (const page of catalog.flatMap((module) => module.pages)) {
			if (!page.name) continue;
			const files = page.source ?? library;
			const exported = new Set<string>();
			for (const file of files)
				for (const key of Object.keys(await import(resolve(root, file))))
					exported.add(key);
			for (const name of page.name.split(" · "))
				assert.ok(
					exported.has(name),
					`${page.id} 的 ${name} 不是 ${files.join("、")} 的导出`,
				);
		}
	});
});

describe("产品图标", () => {
	test("图标页的词表和页面代码里的 lucide 导入一一对应", () => {
		const imported = new Set<string>();
		const root = resolve(import.meta.dirname, "../src");
		for (const file of readdirSync(root, { recursive: true })) {
			if (typeof file !== "string" || !/\.tsx?$/.test(file)) continue;
			if (file.startsWith("components/ui/")) continue;
			const source = readFileSync(resolve(root, file), "utf8");
			for (const [, names] of source.matchAll(
				/import\s*\{([^}]+)\}\s*from\s*"lucide-react"/g,
			)) {
				for (const name of (names ?? "").split(",")) {
					const clean = name.trim().replace(/^type\s+/, "");
					if (clean && !clean.startsWith("Lucide"))
						imported.add(clean.replace(/Icon$/, ""));
				}
			}
		}
		assert.deepEqual(
			[...imported].sort(),
			PRODUCT_ICONS.map(([name]) => name).sort(),
		);
	});
});
