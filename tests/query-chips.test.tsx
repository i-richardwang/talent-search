/**
 * chip 上写什么。一条条件一枚 chip，写的是 AI 给 HR 的那句标签；强度写成字。
 * 菜单是弹层，静态渲染画不出来，这里只看 chip 本身。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryChips } from "#/routes/s/$turnId/-components/query-chips";
import type { QueryCondition } from "#/search/query";
import { visibleText } from "./render";

const markup = (conditions: QueryCondition[]) =>
	renderToStaticMarkup(
		<QueryChips conditions={conditions} onChange={() => {}} />,
	);
const seen = (conditions: QueryCondition[]) => visibleText(markup(conditions));

const chip = (
	label: string,
	mode: QueryCondition["mode"] = "must",
	more: Partial<QueryCondition> = {},
): QueryCondition => ({
	id: label,
	label,
	mode,
	from: "experience",
	terms: { what: [label] },
	where: "true",
	...more,
});

describe("查询 chip", () => {
	test("chip 上是那句标签，SQL 和语义词不上 chip", () => {
		const text = seen([
			chip("近三年两次绩效 A 及以上", "must", {
				from: "person",
				terms: undefined,
				where: "(select count(*) from rating r where r.emp_id = p.emp_id) >= 2",
			}),
			chip("在甲辰科技做过推荐", "must", {
				terms: { what: ["推荐算法", "推荐系统"] },
			}),
		]);
		assert.match(text, /近三年两次绩效 A 及以上/);
		assert.match(text, /在甲辰科技做过推荐/);
		assert.doesNotMatch(text, /select|推荐系统/);
	});

	test("加分、排除写成字，必须是默认，不写强度", () => {
		const text = seen([
			chip("带团队", "boost"),
			chip("实习", "exclude"),
			chip("算法"),
		]);
		assert.match(text, /带团队\s*加分/);
		assert.match(text, /实习\s*排除/);
		assert.doesNotMatch(text, /必须/);
		assert.doesNotMatch(text, /[+−]/, "强度写成字，不写符号");
	});

	test("停用的仍画在屏幕上，读屏说「已停用」", () => {
		const off = [chip("经理", "must", { off: "user" })];
		assert.match(seen(off), /经理/);
		assert.match(markup(off), /aria-label="[^"]*已停用"/);
	});

	test("删除钮说清删的是哪一条", () => {
		assert.match(markup([chip("算法")]), /删除条件「算法」/);
	});

	test("没有条件就不画", () => {
		assert.equal(markup([]), "");
	});
});
