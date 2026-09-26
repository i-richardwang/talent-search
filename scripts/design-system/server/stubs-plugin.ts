import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/*
 * 设计系统里的服务端函数。应用构建时，TanStack Start 的编译把 `src/server/functions.ts`
 * 里每个 `createServerFn` 换成发 RPC 的客户端桩，数据库、模型端点这些服务端模块
 * 不进浏览器。设计系统没有服务端：加载这个文件时按它的导出现场生成同名的桩，
 * 调用一律返回被拒绝的 Promise，组件照常走自己的出错分支，不伪造任何数据。
 */

const FUNCTIONS = /\/src\/server\/functions\.ts$/;

export function stubsPlugin(): Plugin {
	return {
		enforce: "pre",
		load(id) {
			if (!FUNCTIONS.test(id)) return;
			const names = [
				...readFileSync(id, "utf8").matchAll(
					/^export const (\w+) = createServerFn\b/gm,
				),
			].map(([, name]) => name);
			return names
				.map(
					(name) =>
						`export const ${name} = () => Promise.reject(new Error("设计系统不连服务端"));`,
				)
				.join("\n");
		},
		name: "design-system-server-stubs",
	};
}
