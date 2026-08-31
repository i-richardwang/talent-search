/**
 * 页面代码不许从服务端模块取**值**。
 *
 * `#/db` 会传递依赖 Node 专属的 `pg` 与 `Buffer`，只能在服务端求值。
 * 页面只要从这类模块 import 一个值（哪怕只是 `emptyFacets` 这种空对象工厂），
 * 整条链就被打进客户端 bundle，水合第一步抛 `Can't find variable: Buffer`。
 *
 * 为什么非要一条测试：SSR 跑在 Node 里，直出完全正常，`curl` 拿到的 HTML 一切
 * 齐全；tsc、biome、build 也全绿。没有任何一道现有关卡看得见它。
 *
 * `import type` 不算——它在编译期就被擦掉了，这也正是契约住在
 * `#/search/result`（一行 SQL 都没有）而不是 `#/search/search` 的原因。
 * `#/server/functions` 不在名单里：`createServerFn` 造出来的是同构的 RPC 桩，
 * 页面本来就该直接调它。
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { describe, test } from "node:test";

/**
 * 这些模块的传递依赖里有 Node 专属的东西，只能在服务端求值。
 *
 * `#/server/llm` 在名单里的理由和其余几个不同，但更硬：它读 `LLM_API_KEY`，
 * 页面从它取一个值就等于把密钥和整个 AI SDK 一起发给浏览器。
 */
const SERVER_ONLY = new Set([
	normalize("src/db/index.ts"),
	normalize("src/db/schema.ts"),
	normalize("src/search/search.ts"),
	normalize("src/server/llm.ts"),
	normalize("src/server/turn.ts"),
]);

/**
 * createServerFn 的同构桩是有意保留的客户端边界，不继续追进它的 handler。
 *
 * **这个集合只该有一个成员。** 每加一个都是在给自己开一处豁免：插件切走的只有
 * handler 的**函数体**，同一个文件里 handler 之外的代码照进客户端 bundle。
 * 想加第二个之前，先把那个文件里碰服务端模块的代码搬进服务端专属模块。
 */
const RPC_BOUNDARY = new Set([normalize("src/server/functions.ts")]);

/** 页面代码：会被打进客户端 bundle 的那些目录 */
const CLIENT_DIRS = ["src/routes", "src/components"];

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const path = join(dir, e.name);
		if (e.isDirectory()) return walk(path);
		return [".ts", ".tsx"].includes(extname(e.name)) ? [path] : [];
	});
}

/** 一条 import 语句取的是不是值。`import type ...` 与全部具名都带 type 的都不是。 */
function importsValue(clause: string) {
	const c = clause.trim();
	if (c.startsWith("type ")) return false;
	const named = c.match(/^\{([^}]*)\}$/)?.[1];
	if (named === undefined) return true; // 默认导入 / 命名空间导入，一定是值
	return named
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.some((s) => !s.startsWith("type "));
}

function resolveLocal(from: string, specifier: string) {
	let base: string;
	if (specifier.startsWith("#/")) base = join("src", specifier.slice(2));
	else if (specifier.startsWith(".")) base = join(dirname(from), specifier);
	else return undefined;
	for (const candidate of [
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
		base,
	]) {
		// 目录要排在最后，而且只认文件：`#/db` 既是目录也有 index.ts，
		// 先命中目录的话下一步 readFileSync 会拿 EISDIR 炸掉，
		// 而那个错误读起来完全不像「解析到了一个目录」。
		if (existsSync(candidate) && extname(candidate))
			return normalize(candidate);
	}
	return undefined;
}

function valueDependencies(file: string) {
	const src = readFileSync(file, "utf8");
	const specs: string[] = [];
	for (const [, clause = "", mod = ""] of src.matchAll(
		/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g,
	)) {
		if (importsValue(clause)) specs.push(mod);
	}
	for (const [, mod = ""] of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
		specs.push(mod);
	}
	for (const [, clause = "", mod = ""] of src.matchAll(
		/export\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g,
	)) {
		if (!clause.trim().startsWith("type ")) specs.push(mod);
	}
	return specs.flatMap((specifier) => {
		const resolved = resolveLocal(file, specifier);
		return resolved ? [resolved] : [];
	});
}

function serverPathFrom(entry: string) {
	const seen = new Set<string>();
	const visit = (file: string, chain: string[]): string[] | undefined => {
		if (SERVER_ONLY.has(file)) return [...chain, file];
		if (seen.has(file) || RPC_BOUNDARY.has(file)) return undefined;
		seen.add(file);
		for (const dependency of valueDependencies(file)) {
			const found = visit(dependency, [...chain, file]);
			if (found) return found;
		}
		return undefined;
	};
	return visit(normalize(entry), []);
}

describe("客户端与服务端的边界", () => {
	for (const dir of CLIENT_DIRS) {
		for (const file of walk(dir)) {
			test(`${file} 的值依赖不进入服务端模块`, () => {
				const path = serverPathFrom(file);
				assert.equal(
					path,
					undefined,
					`${path?.join(" -> ")} 把服务端代码带进了客户端。数据库访问请走 #/server/functions。`,
				);
			});
		}
	}
});
