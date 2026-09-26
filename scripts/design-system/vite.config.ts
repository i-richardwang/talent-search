import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { applyPlugin } from "./server/apply-plugin";
import { stubsPlugin } from "./server/stubs-plugin";

/**
 * 设计系统（`bun run ui`）：`/` 是外壳，`/preview` 是外壳里 iframe 加载的预览页；
 * 开发服务器另有一个把修改版写回源文件的接口（`server/apply-plugin.ts`）。产品组件用到的
 * 服务端函数换成调用即失败的桩（`server/stubs-plugin.ts`）。
 */
export default defineConfig({
	plugins: [stubsPlugin(), tailwindcss(), viteReact(), applyPlugin()],
	resolve: { tsconfigPaths: true },
	root: import.meta.dirname,
	server: { port: 3200 },
});
