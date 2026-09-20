/**
 * 名单为什么是空的——**成因判定**这一半（`search/empty.ts`）。
 *
 * 这几种成因在屏幕上长得一模一样（都是零行），说错了不会有任何断言失败，
 * 用户只会拿到一句不对症的建议。所以每一支都在这里测；说什么、给哪条出路
 * 是另一半，归 `tests/empty-state.test.ts`。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { emptyReason } from "#/search/empty";
import type { SearchFilters } from "#/search/params";
import { parseQuery } from "#/search/query-syntax";
import type { Claim } from "#/search/result";
import { claim } from "./conditions";

function why(args: {
	/** 一行查询语法，见 `search/query-syntax.ts`。 */
	query?: string;
	filters?: SearchFilters;
	total?: number;
	overflow?: Parameters<typeof emptyReason>[0]["overflow"];
}) {
	return emptyReason({
		spec: { conditions: parseQuery(args.query ?? "") },
		filters: args.filters ?? {},
		total: args.total ?? 0,
		overflow: args.overflow ?? null,
	});
}

test("有人就没有成因：要不要画空态和空态说什么是同一个问题", () => {
	assert.equal(why({ query: "算法", total: 3 }), null);
	// 只有人的条件同样：没有经历主张不等于没有结果
	assert.equal(why({ query: "education:硕士", total: 3 }), null);
});

describe("取数超限", () => {
	test("排在最前：它不是「没有人」，而且和筛选太窄的出路相反", () => {
		const overflow = {
			kind: "overflowEvidence" as const,
			claims: [claim("运营") as Claim],
		};
		const reason = why({
			query: "运营",
			filters: { seq: [{ l1: "技术", l2: "后端" }] },
			overflow,
		});
		assert.deepEqual(reason, overflow);
	});
});

describe("没有可执行的经历主张", () => {
	test("条件全被停用——和「没有这样的人」正好相反", () => {
		assert.deepEqual(why({ query: "~渠道运营,~+带团队" }), {
			kind: "allDisabled",
		});
	});

	test("停用的排除不算「我把条件停了」：它本来就不产出人", () => {
		assert.deepEqual(why({ query: "~-实习" }), { kind: "excludeOnly" });
	});

	test("只写了排除", () => {
		assert.deepEqual(why({ query: "-实习" }), { kind: "excludeOnly" });
	});

	test("一个条件都没解析出来", () => {
		assert.deepEqual(why({ query: "" }), { kind: "noConditions" });
	});

	test("只有人的必须条件时说没有这样的人；筛着的时候先怪筛选", () => {
		assert.deepEqual(why({ query: "education:硕士" }), { kind: "personEmpty" });
		assert.deepEqual(
			why({ query: "education:硕士", filters: { level: ["P7"] } }),
			{ kind: "filtered" },
		);
	});

	test("没有经历词的主张也是主张：范围里没人是「没满足必须条件」", () => {
		assert.deepEqual(why({ query: "kind:external" }), { kind: "unmet" });
	});
});

describe("有条件但没人", () => {
	test("筛选太窄", () => {
		assert.deepEqual(why({ query: "算法", filters: { level: ["P7"] } }), {
			kind: "filtered",
		});
	});

	test("什么都没筛还是空：AND 没满足", () => {
		assert.deepEqual(why({ query: "算法" }), { kind: "unmet" });
	});

	test("没有一条是必须的：出路是换词，不是「把条件改成加分」", () => {
		assert.deepEqual(why({ query: "+算法" }), { kind: "noHits" });
		// 人的偏好不删人，「没有这样的人」对它不成立
		assert.deepEqual(why({ query: "+education:硕士" }), { kind: "noHits" });
		// 必须的人的条件加上加分的主张：候选是条件里沾上主张的人，说不清是哪一头空了
		assert.deepEqual(why({ query: "+算法,education:硕士" }), {
			kind: "noHits",
		});
	});
});
