import { basename, extname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { SourceData } from "./contract";
import type { Report } from "./report";
import * as csvDir from "./sources/csv-dir";

type Source = { extract: (report: Report) => Promise<SourceData> };

export type SourceConfig = {
	name: string;
	modulePath: string | null;
};

const BUILT_IN_SOURCE = "csv-dir";

export function sourceConfig(): SourceConfig {
	const configured = process.env.TALENT_SOURCE?.trim() || BUILT_IN_SOURCE;
	if (configured === BUILT_IN_SOURCE)
		return { name: BUILT_IN_SOURCE, modulePath: null };
	return {
		name: basename(configured, extname(configured)),
		modulePath: configured,
	};
}

export async function loadSource(config: SourceConfig): Promise<Source> {
	let module: unknown;
	try {
		if (config.modulePath === null) module = csvDir;
		else {
			if (!isAbsolute(config.modulePath))
				throw new Error("TALENT_SOURCE 必须是 csv-dir 或私有适配器的绝对路径");
			module = await import(
				/* @vite-ignore */ pathToFileURL(config.modulePath).href
			);
		}
	} catch (cause) {
		throw new Error(`读取数据源 ${config.name} 失败`, { cause });
	}
	if (
		typeof module !== "object" ||
		module === null ||
		typeof (module as Source).extract !== "function"
	)
		throw new Error(
			`数据源 ${config.name} 没有 extract()，它不满足 src/corpus/contract.ts`,
		);
	return module as Source;
}
