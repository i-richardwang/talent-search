/**
 * 找人界面上的每一段字面文字都不含内部用词（`lib/internal-words.ts`）。
 *
 * 读的是源码里的字符串和 JSX 文字，不是渲染结果：渲染只覆盖测试搭得出的那几种
 * 状态，一句只在报错时出现的话就漏了。注释不算——它是写给改代码的人看的。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { internalWordsIn } from "#/lib/internal-words";

/** 管理页的读者是管理员；`api/` 是给外部判定方的接口，不上屏。 */
const ADMIN = /^src\/routes\/(api\/|tasks|skills|data)/;

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true, recursive: true })
		.filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
		.map((e) => join(e.parentPath, e.name))
		.filter((path) => !ADMIN.test(path) && !path.includes("components/ui/"));
}

const FILES = [
	...sources("src/routes"),
	...sources("src/components"),
	"src/search/condition-label.ts",
];

/** 一个文件里所有会成为界面文字的字面量：字符串、模板里的字、JSX 文字。 */
function literals(path: string): string[] {
	const file = ts.createSourceFile(
		path,
		readFileSync(path, "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const found: string[] = [];
	const visit = (node: ts.Node) => {
		if (
			ts.isStringLiteral(node) ||
			ts.isNoSubstitutionTemplateLiteral(node) ||
			ts.isTemplateHead(node) ||
			ts.isTemplateMiddle(node) ||
			ts.isTemplateTail(node)
		)
			found.push(node.text);
		else if (ts.isJsxText(node)) found.push(node.getText());
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

test("找人界面的文字不含内部用词", () => {
	const hits = FILES.flatMap((path) =>
		literals(path).flatMap((text) =>
			internalWordsIn(text).map((word) => `${path}：「${word}」在「${text}」`),
		),
	);
	assert.deepEqual(hits, []);
});

test("扫得到东西：文件和字面量都不是空的", () => {
	assert.ok(FILES.some((path) => path.endsWith("thread.tsx")));
	assert.ok(
		literals(FILES.find((p) => p.endsWith("thread.tsx")) ?? "").length > 10,
	);
});
