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
import { emptyReason, type Incomplete } from "#/search/empty";
import type { SearchFilters } from "#/search/params";
import { parseQuery } from "#/search/query-syntax";

function why(args: {
	/** 一行查询语法，见 `search/query-syntax.ts`。 */
	query?: string;
	filters?: SearchFilters;
	total?: number;
	/** 候选人还没确认完时确认到了哪一档 */
	incomplete?: Incomplete;
}) {
	return emptyReason({
		query: compileConditions(parseQuery(args.query ?? "")),
		filters: args.filters ?? {},
		total: args.total ?? 0,
		incomplete: args.incomplete,
	});
}

test("有人就没有成因：要不要画空态和空态说什么是同一个问题", () => {
	assert.equal(why({ query: "算法", total: 3 }), null);
	// 只有人的条件同样：没有经历主张不等于没有结果
	assert.equal(why({ query: "education:硕士", total: 3 }), null);
});

describe("候选人还没确认完", () => {
	const incomplete = { above: "P7" };

	test("名单上没人、候选人没确认完：说的是还没确认完和确认到了哪一档，不是没有这样的人，也不怪筛选", () => {
		const reason = { kind: "incomplete", above: "P7" };
		assert.deepEqual(why({ query: "运营", incomplete }), reason);
		assert.deepEqual(
			why({ query: "运营", filters: { level: ["P7"] }, incomplete }),
			reason,
			"排在筛选太窄前面：没确认的那些人就在这份筛选里",
		);
	});

	test("名单上有人就没有成因，哪怕候选人没确认完；都确认过了才轮到别的成因", () => {
		assert.equal(why({ query: "运营", total: 3, incomplete }), null);
		assert.deepEqual(why({ query: "运营" }), { kind: "unmet" });
	});
});

describe("没有可执行的经历主张", () => {
	test("条件全被停用——和「没有这样的人」正好相反", () => {
		assert.deepEqual(why({ query: "~渠道运营,~+带团队" }), {
			kind: "allDisabled",
		});
		assert.deepEqual(why({ query: "~-实习" }), { kind: "allDisabled" });
	});

	test("只写了排除：它和门槛一样只定去留，没人就是没有这样的人", () => {
		assert.deepEqual(why({ query: "-实习" }), { kind: "gatesUnmet" });
	});

	test("一个条件都没解析出来", () => {
		assert.deepEqual(why({ query: "" }), { kind: "noConditions" });
	});

	test("只有门槛时说没有这样的人；筛着的时候先怪筛选", () => {
		assert.deepEqual(why({ query: "education:硕士" }), { kind: "gatesUnmet" });
		assert.deepEqual(
			why({ query: "education:硕士", filters: { level: ["P7"] } }),
			{ kind: "filtered" },
		);
	});

	test("背景和人的条件一样是门槛：范围里没人时同样说没有这样的人", () => {
		assert.deepEqual(why({ query: "kind:external" }), { kind: "gatesUnmet" });
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

	test("没有一条是必须的：下一步是换词，不是「把条件改成加分」", () => {
		assert.deepEqual(why({ query: "+算法" }), { kind: "noneMatched" });
		// 人的偏好不删人，「没有这样的人」对它不成立
		assert.deepEqual(why({ query: "+education:硕士" }), {
			kind: "noneMatched",
		});
		// 必须的人的条件加上加分的主张：候选是条件里沾上主张的人，说不清是哪一头空了
		assert.deepEqual(why({ query: "+算法,education:硕士" }), {
			kind: "noneMatched",
		});
	});
});
