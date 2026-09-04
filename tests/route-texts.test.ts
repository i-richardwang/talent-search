/**
 * 夹具拼出来的四路原文，必须和语料侧拼出来的是同一种字符串。
 *
 * 查询侧嵌的是用户的说法，语料侧嵌的是 `etl/embed.py` 的 `route_texts` 拼出来的
 * 字符串——集成测试要造语料，就得在 TypeScript 里再拼一遍（`tests/fixture.ts` 的
 * `routeTexts`）。跨语言，谁也调不了谁，所以两侧各自对同一份契约求值：
 * `etl/route_texts.contract.json`。
 *
 * 这份契约是手写的，不由任何一侧生成。生成的话，改坏了拼法只要重跑一次生成就
 * 「绿」了，而那正是它要拦的事。改拼法就是改契约，然后两边一起红。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Route } from "#/db/schema";
import { routeTexts } from "./fixture";

type Case = {
	name: string;
	/** 字段名是经历表的列名；夹具拿到的是 drizzle 行，改成它的写法。 */
	row: Record<string, string>;
	texts: Partial<Record<Route, string>>;
};

const contract = JSON.parse(
	readFileSync(
		new URL("../etl/route_texts.contract.json", import.meta.url),
		"utf8",
	),
) as { cases: Case[] };

describe("四路原文的拼法", () => {
	for (const { name, row, texts } of contract.cases)
		test(name, () => {
			assert.deepEqual(
				Object.fromEntries(
					routeTexts({
						kind: row.kind as "internal" | "external",
						org: row.org ?? "",
						orgPath: row.org_path ?? "",
						title: row.title ?? "",
						seqL1: row.seq_l1 ?? "",
						seqL2: row.seq_l2 ?? "",
						seqL3: row.seq_l3 ?? "",
						description: row.description ?? "",
					}),
				),
				texts,
			);
		});

	test("契约本身不能是空的——它是两侧唯一的共同约束", () => {
		assert.ok(contract.cases.length > 0);
	});
});
