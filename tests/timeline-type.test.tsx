/**
 * 时间轴卡片的字号层次。
 *
 * 这几条是量出来的、看不见的约束，最容易在改文案时被顺手改掉，所以钉在这里：
 *
 * 1. 简历原文必须比卡片标题小一档。它是卡片里最长的一块，也是最弱的一路证据
 *    （weights.ts 里 0.25），和标题同为 14 时卡片内部就没有层次了；
 * 2. 那条元数据行（起止年月 · 时长、序列、公司属性）三样是同一类东西，
 *    必须同一档——`mono` 变体在 Kumo 里恒是 13，所以另外两个跟到 13；
 * 3. 「入职前」不是实心徽章。实心是整张卡片里对比最高的一块，而它标的是
 *    最不需要强调的东西。
 *
 * 断言的是类名而不是可见文本：字号这件事在 DOM 里只有类名这一个形态。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Experience } from "#/db/schema";
import { Timeline } from "#/routes/-components/timeline";

const seg = (over: Partial<Experience> = {}): Experience =>
	({
		id: 1,
		empId: "T0001",
		kind: "internal",
		startDate: "2020-01-01",
		endDate: null,
		org: "某部门",
		orgPath: "某事业部/某部门",
		orgMeta: null,
		title: "某岗位",
		seqL1: "技术",
		seqL2: "算法",
		seqL3: "",
		level: "M3",
		description: "",
		months: 24,
		...over,
	}) as Experience;

const html = (rows: Experience[]) =>
	renderToStaticMarkup(<Timeline hitIndex={new Map()} rows={rows} />);

describe("时间轴卡片的字号层次", () => {
	test("简历原文比卡片标题小一档，且走 read-cjk 的行高与行长", () => {
		const s = html([
			seg({ kind: "external", description: "负责渠道拓展与团队管理。" }),
		]);
		assert.match(s, /class="read-cjk[^"]*text-sm"/);
		assert.doesNotMatch(s, /class="read-cjk[^"]*text-base"/);
	});

	test("元数据行三样同一档：起止年月、序列、公司属性都是 13", () => {
		const s = html([
			seg({
				kind: "external",
				seqL1: "",
				seqL2: "",
				seqL3: "",
				orgMeta: { company_tag: "某档", industry: "某行业", nature: "某性质" },
			}),
		]);
		// mono 变体恒是 sm；公司属性跟着它，不许退回 xs
		assert.match(s, /font-mono[^"]*text-sm/);
		assert.match(s, /text-kumo-subtle text-sm/);
	});

	test("「入职前」是描边徽章，不是实心的", () => {
		const s = html([seg({ kind: "external" })]);
		assert.ok(s.includes("入职前"), "标记本身不能丢");
		assert.doesNotMatch(s, /bg-kumo-badge-neutral/);
	});

	test("公司内的段不画「入职前」", () => {
		assert.ok(!html([seg()]).includes("入职前"));
	});
});
