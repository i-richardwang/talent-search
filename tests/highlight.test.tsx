/**
 * 简历原文是可信度最低的一路，界面的补偿是把原文摆出来、把命中标出来。
 * 「提过几次」本身就是判断依据，所以每一处都得标——只标第一处会误导。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Highlight } from "#/routes/-components/evidence";

const marks = (text: string, term: string) => {
	const html = renderToStaticMarkup(<Highlight term={term} text={text} />);
	return { html, count: html.match(/<mark/g)?.length ?? 0 };
};

describe("原文命中高亮", () => {
	test("一段里出现几次就标几次", () => {
		assert.equal(marks("配合算法团队，配合产品团队", "配合").count, 2);
	});

	test("命中贴在开头和结尾时，中间的字不能丢", () => {
		const { html, count } = marks("配合团队配合", "配合");
		assert.equal(count, 2);
		assert.match(html, /团队/);
	});

	test("大小写不敏感，但原文的大小写要保留", () => {
		const { html, count } = marks("负责 SaaS 与 saas 两条线", "SAAS");
		assert.equal(count, 2);
		assert.match(html, /SaaS/);
		assert.match(html, /saas/);
	});

	test("没有命中就原样返回", () => {
		assert.equal(marks("算法团队", "配合").count, 0);
	});

	test("空词不进循环，也不会死循环", () => {
		const { html, count } = marks("算法团队", "");
		assert.equal(count, 0);
		assert.match(html, /算法团队/);
	});
});
