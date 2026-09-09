/**
 * 名单为什么是空的——**成因判定**这一半（`search/empty.ts`）。
 *
 * 这几种成因在屏幕上长得一模一样（都是零行），说错了没有任何断言会红，
 * 用户只会拿到一句不对症的建议。所以每一支都在这里测；说什么、给哪条出路
 * 是另一半，归 `tests/empty-state.test.ts`。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { emptyReason } from "#/search/empty";
import { parseQuery } from "#/search/query-syntax";
import type { SearchFilters, TermPlan } from "#/search/result";

const must = (term: string): TermPlan => ({
	term,
	values: [term],
	mode: "must",
});

function why(args: {
	/** 一行查询语法，见 `search/query-syntax.ts`。范围也写在里面：`kind:external`。 */
	query?: string;
	terms?: TermPlan[];
	filters?: SearchFilters;
	total?: number;
	withoutStrong?: number;
	overflow?: Parameters<typeof emptyReason>[0]["overflow"];
}) {
	return emptyReason({
		spec: { terms: parseQuery(args.query ?? "") },
		filters: args.filters ?? {},
		terms: args.terms ?? [],
		total: args.total ?? 0,
		withoutStrong: args.withoutStrong ?? 0,
		overflow: args.overflow ?? null,
	});
}

test("有人就没有成因：要不要画空态和空态说什么是同一个问题", () => {
	assert.equal(why({ terms: [must("算法")], total: 3 }), null);
	// 结构化查询同样：没有经历条件不等于没有结果
	assert.equal(why({ query: "kind:external", total: 3 }), null);
});

describe("取数超限", () => {
	test("排在最前：它不是「没有人」，而且和筛选太窄的出路相反", () => {
		const reason = why({
			terms: [must("运营")],
			query: "运营",
			filters: { seq: [{ l1: "技术", l2: "后端" }] },
			overflow: { kind: "overflowEvidence", terms: ["运营"] },
		});
		assert.deepEqual(reason, { kind: "overflowEvidence", terms: ["运营"] });
	});
});

describe("没有可执行的经历条件", () => {
	test("条件全被停用——和「没有这样的人」正好相反", () => {
		assert.deepEqual(why({ query: "~渠道运营,~+带团队" }), {
			kind: "allDisabled",
		});
	});

	test("停用的排除词不算「我把条件停了」：它本来就不产出人", () => {
		assert.deepEqual(why({ query: "~-实习" }), { kind: "excludeOnly" });
	});

	test("只写了排除词", () => {
		assert.deepEqual(why({ query: "-实习" }), { kind: "excludeOnly" });
	});

	test("一个词都没解析出来", () => {
		assert.deepEqual(why({ query: "" }), { kind: "noConditions" });
	});

	test("只有结构化范围时说范围里没人；筛着的时候先怪筛选", () => {
		assert.deepEqual(why({ query: "kind:external" }), { kind: "scopeEmpty" });
		assert.deepEqual(
			why({ query: "kind:external", filters: { level: ["P7"] } }),
			{ kind: "filtered" },
		);
	});
});

describe("有条件但没人", () => {
	const terms = [must("算法")];

	test("证据要求滤空了：带上关掉之后能看到几个", () => {
		assert.deepEqual(
			why({
				terms,
				query: "算法",
				filters: { strong: true },
				withoutStrong: 12,
			}),
			{ kind: "strongEmpty", without: 12 },
		);
	});

	test("开着证据要求但关掉也没人时，成因不是它", () => {
		assert.deepEqual(why({ terms, query: "算法", filters: { strong: true } }), {
			kind: "unmet",
		});
	});

	test("筛选太窄", () => {
		assert.deepEqual(
			why({ terms, query: "算法", filters: { level: ["P7"] } }),
			{ kind: "filtered" },
		);
	});

	test("证据要求不算「收窄人群的筛选」：它改的是什么才算命中", () => {
		assert.deepEqual(why({ terms, query: "算法", filters: { strong: true } }), {
			kind: "unmet",
		});
	});

	test("什么都没筛还是空：AND 没满足", () => {
		assert.deepEqual(why({ terms, query: "算法" }), { kind: "unmet" });
	});

	test("没有一条是必须的：出路是换词，不是「把条件改成加分」", () => {
		const boost: TermPlan = { term: "算法", values: ["算法"], mode: "boost" };
		assert.deepEqual(why({ terms: [boost], query: "+算法" }), {
			kind: "noHits",
		});
		// 偏好的范围不删人，「范围里没人」对它不成立
		assert.deepEqual(why({ query: "+org:字节" }), { kind: "noHits" });
		// 必须的范围加上加分词：候选是范围里沾上词的人，说不清是哪一头空了
		assert.deepEqual(why({ terms: [boost], query: "+算法,kind:external" }), {
			kind: "noHits",
		});
	});
});
