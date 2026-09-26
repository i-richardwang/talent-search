import type { Sources } from "./tokens/css";

/*
 * 声明令牌的源文件原文，键写成仓库路径（`src/…`）。模式与 `TOKEN_SOURCE_PATTERNS`
 * 一致（Vite 要求这里写字面量）；文件一改，开着的设计系统跟着更新。
 */
const files = import.meta.glob<string>(
	["../../../src/styles.css", "../../../src/components/ui/*.css"],
	{ eager: true, import: "default", query: "?raw" },
);

export const sources: Sources = Object.fromEntries(
	Object.entries(files).map(([path, text]) => [
		path.replace(/^(\.\.\/)+/, ""),
		text,
	]),
);
