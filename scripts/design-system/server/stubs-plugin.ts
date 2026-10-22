import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/*
 * 设计系统没有服务端。RPC 模块在解析时换成虚拟模块，依赖扫描也不会进入数据库与端点。
 * 加载时按 createServerFn 导出生成同名的桩，调用都返回被拒绝的 Promise，
 * 组件走自己的出错分支，不伪造任何数据。
 */

const FUNCTIONS = /\/src\/server\/(?:auth-)?functions\.ts$/;
const PREFIX = "\0design-system-stub:";

export function stubsPlugin(): Plugin {
	return {
		enforce: "pre",
		async resolveId(source, importer) {
			if (source.startsWith(PREFIX)) return source;
			const resolved = await this.resolve(source, importer, { skipSelf: true });
			if (resolved && FUNCTIONS.test(resolved.id)) return PREFIX + resolved.id;
		},
		load(id) {
			if (!id.startsWith(PREFIX)) return;
			const names = [
				...readFileSync(id.slice(PREFIX.length), "utf8").matchAll(
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
