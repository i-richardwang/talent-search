/**
 * 名单为什么是空的——**成因判定**这一半（`search/empty.ts`）。
 *
 * 这几种成因在屏幕上长得一模一样（都是零行），说错了不会有任何断言失败，
 * 用户只会拿到一句不对症的建议。所以每一支都在这里测；说什么、给哪条下一步
 * 是另一半，归 `tests/empty-state.test.ts`。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compileConditions } from "#/search/compile";
import { emptyReason, type Incomplete, inactiveReason } from "#/search/empty";
import type { SearchFilters } from "#/search/params";
import { parseQuery } from "#/search/query-syntax";

/** 每一项单独都有人，只是凑不到一起 */
const UNMET = { kind: "unmet", nobody: [] };

/** 有启用的条件时的成因。`nobody` 是单独就没有人的那几项；没写时每一项都有人。 */
function why(args: {
	filters?: SearchFilters;
	total?: number;
	/** 候选人还没确认完时确认到了哪一档 */
	incomplete?: Incomplete;
	nobody?: string[];
}) {
	return emptyReason({
		filters: args.filters ?? {},
		total: args.total ?? 0,
		incomplete: args.incomplete,
		nobody: async () => args.nobody ?? [],
	});
}

/** 一行查询语法（见 `search/query-syntax.ts`）里没有启用的条件时的成因。 */
const inactive = (query: string) =>
	inactiveReason(compileConditions(parseQuery(query)));

test("有人就没有成因：要不要画空态和空态说什么是同一个问题", async () => {
	assert.equal(await why({ total: 3 }), null);
});

describe("候选人还没确认完", () => {
	const incomplete = { above: "P7" };

	test("名单上没人、候选人没确认完：说的是还没确认完和确认到了哪一档，不是没有这样的人，也不怪筛选", async () => {
		const reason = { kind: "incomplete", above: "P7" };
		assert.deepEqual(await why({ incomplete }), reason);
		assert.deepEqual(
			await why({ filters: { level: ["P7"] }, incomplete }),
			reason,
			"排在筛选太窄前面：没确认的那些人就在这份筛选里",
		);
	});

	test("名单上有人就没有成因，哪怕候选人没确认完", async () => {
		assert.equal(await why({ total: 3, incomplete }), null);
	});
});

describe("没有启用的条件", () => {
	test("条件全被停用——和「没有这样的人」正好相反", () => {
		assert.deepEqual(inactive("~渠道运营,~+带团队"), { kind: "allDisabled" });
		assert.deepEqual(inactive("~-实习"), { kind: "allDisabled" });
	});

	test("一个条件都没解析出来", () => {
		assert.deepEqual(inactive(""), { kind: "noConditions" });
	});
});

describe("有条件但没人", () => {
	test("单独就没有人的那几项原样带上：说的是确定的事", async () => {
		assert.deepEqual(await why({ nobody: ["x"] }), {
			kind: "unmet",
			nobody: ["x"],
		});
	});

	test("筛着的时候先怪筛选，不去数哪一项没有人", async () => {
		let counted = false;
		const reason = await emptyReason({
			filters: { level: ["P7"] },
			total: 0,
			incomplete: undefined,
			nobody: async () => {
				counted = true;
				return [];
			},
		});
		assert.deepEqual(reason, { kind: "filtered" });
		assert.equal(counted, false);
	});

	test("什么都没筛还是空：每一项都有人时是凑不到一起", async () => {
		assert.deepEqual(await why({}), UNMET);
	});
});
