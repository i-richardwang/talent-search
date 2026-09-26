/**
 * 测试的预加载：设计系统在浏览器里用 Vite 的 `import.meta.glob` 取令牌源文件的原文
 * （`shared/source-files.ts`），Bun 没有这个写法。这里把那个模块换成按同一组模式
 * （`TOKEN_SOURCE_PATTERNS`）从磁盘读出的原文。并行跑测试时插件的 onLoad 不会被调用，
 * 所以按文件的绝对路径用 `build.module` 注册。读的是十几个 CSS 文件，所有测试都预加载
 * 也只多几毫秒，不按测试分开。
 */
import { resolve } from "node:path";
import { readTokenSources } from "../scripts/design-system/server/token-sources";

/**
 * 这里用到的那一段 Bun 插件接口。装 Bun 的全局类型会把 `fetch` 换成 Bun 的版本，
 * 产品代码里 `typeof fetch` 的声明跟着变，所以只写这一段。
 */
interface RuntimePlugins {
	plugin(options: {
		name: string;
		setup(build: {
			module(
				specifier: string,
				load: () => { contents: string; loader: "js" },
			): void;
		}): void;
	}): void;
}

const runtime = (globalThis as { Bun?: RuntimePlugins }).Bun;
if (!runtime) throw new Error("预加载要在 Bun 里跑");

runtime.plugin({
	name: "design-system-sources",
	setup(build) {
		build.module(
			resolve(
				import.meta.dirname,
				"../scripts/design-system/shared/source-files.ts",
			),
			() => ({
				contents: `export const sources = ${JSON.stringify(readTokenSources())};`,
				loader: "js",
			}),
		);
	},
});
