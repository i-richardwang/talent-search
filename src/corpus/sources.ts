/**
 * 数据源适配器。一个适配器 = 一个 `extract(): Promise<SourceData>` 的模块。
 *
 * **`sources/` 目录默认不进版本库**（见根 `.gitignore`）：接进来的人事数据长
 * 什么样、字段叫什么、字典码怎么定义，本身就是一家公司的内部信息。仓库里只
 * 保留 `csv-dir` 这一份参考实现，任何新增的适配器天然是私有的——白名单式的
 * ignore 规则保证「忘了加 ignore」这件事不可能发生。
 *
 * 接自己的数据源：复制 `csv-dir.ts` 改成 `sources/<你的名字>.ts`，
 * 在 `.env.local` 里设 `TALENT_SOURCE=<你的名字>`。
 *
 * **按名字取模块用的是带变量的动态 import**，写法是 Vite 认得的那一种（`./` 开头、
 * 只差一级文件名、带扩展名）：构建时它会把 `sources/` 下**当时在场的**每个适配器
 * 都打进产物，应用进程和命令行拿到的是同一份代码。写成一张手维护的
 * 注册表就不成立了——那张表在版本库里，而私有适配器不在。
 */

import type { SourceData } from "./contract";
import type { Report } from "./report";

/** 适配器模块的形状。`report` 让适配器把「读了哪个目录、跳过了什么」说出来。 */
type Source = { extract: (report: Report) => Promise<SourceData> };

/** 不配 `TALENT_SOURCE` 时读哪个适配器。 */
const DEFAULT_SOURCE = "csv-dir";

export function sourceName(): string {
	return process.env.TALENT_SOURCE?.trim() || DEFAULT_SOURCE;
}

export async function loadSource(name: string): Promise<Source> {
	let module: unknown;
	try {
		module = await import(`./sources/${name}.ts`);
	} catch (cause) {
		/*
		 * 这里判不出是哪一种失败：「没有这个适配器」和「适配器自己坏了」（少一个
		 * 依赖、顶层就抛）从 `import` 出来长得一模一样。所以不下诊断，只说清是哪一步
		 * 出的事，真正发生了什么由 `cause` 说——`src/server/tasks.ts` 把整条来由
		 * 逐层写进那次任务的日志。
		 */
		throw new Error(
			`读取数据源 ${name} 失败。私有适配器放在 src/corpus/sources/ 下` +
				"（不进版本库），用 TALENT_SOURCE 选中",
			{ cause },
		);
	}
	if (
		typeof module !== "object" ||
		module === null ||
		typeof (module as Source).extract !== "function"
	)
		throw new Error(
			`数据源 ${name} 没有 extract()，它不满足 src/corpus/contract.ts`,
		);
	return module as Source;
}
