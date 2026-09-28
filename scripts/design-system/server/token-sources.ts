import { globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Sources, TOKEN_SOURCE_PATTERNS } from "../shared/tokens/css";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** 在磁盘上按 `TOKEN_SOURCE_PATTERNS` 读出声明令牌的源文件，键是仓库路径。 */
export function readTokenSources(): Sources {
	return Object.fromEntries(
		globSync([...TOKEN_SOURCE_PATTERNS], { cwd: REPO_ROOT })
			.sort()
			.map((file) => [file, readFileSync(join(REPO_ROOT, file), "utf8")]),
	);
}
