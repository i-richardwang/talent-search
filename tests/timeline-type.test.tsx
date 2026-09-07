/**
 * 时间轴卡片的字号层次。
 *
 * 这几条是量出来的、看不见的约束，最容易在改文案时被顺手改掉，所以写成这里的测试：
 *
 * 1. 简历原文必须比卡片标题小一档。它是卡片里最长的一块，也是最弱的一路证据
 *    （weights.ts 里 0.25），和标题同为 14 时卡片内部就没有层次了；
 * 2. 那条元数据行（起止年月 · 时长、序列、公司属性）三样是同一类东西，
 *    必须同一档——字号和颜色都由那一行的容器给，三样各自不许再挂一档；
 * 3. 「入职前」不是实心徽章。实心是整张卡片里对比最高的一块，而它标的是
 *    最不需要强调的东西。
 *
 * 断言的是类名而不是可见文本：字号这件事在 DOM 里只有类名这一个形态。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Timeline } from "#/components/timeline";
import type { Experience } from "#/db/schema";
import { experience as seg } from "./rows";

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

	test("元数据行三样同一档：起止年月、序列、公司属性同字号同色", () => {
		const s = html([
			seg({
				kind: "external",
				seqL1: "",
				seqL2: "",
				seqL3: "",
				orgMeta: { company_tag: "某档", industry: "某行业", nature: "某性质" },
			}),
		]);
		// 字号和颜色都由那一行的容器给，三样各自不许再挂自己的一档——
		// 挂了就会出现同一行里两个角色相同的标注差一档的情况
		assert.match(
			s,
			/flex flex-wrap items-baseline[^"]*text-muted-foreground text-xs/,
		);
		assert.match(s, /class="font-mono tabular-nums"/);
		assert.match(s, /<span>某档 · 某行业 · 某性质<\/span>/);
	});

	test("「入职前」是描边徽章，不是实心的", () => {
		const s = html([seg({ kind: "external" })]);
		assert.ok(s.includes("入职前"), "标记本身不能丢");
		// default 变体是实心深底浅字（bg-primary），outline 不该有它
		assert.doesNotMatch(s, /data-slot="badge"[^>]*bg-primary/);
	});

	test("公司内的段不画「入职前」", () => {
		assert.ok(!html([seg()]).includes("入职前"));
	});

	test("入职前的段写的是对齐的序列并标明是推断；登记的序列照原样写", () => {
		const aligned = html([
			seg({
				kind: "external",
				seqL1: "",
				seqL2: "",
				seqL3: "",
				seqInferredL1: "技术",
				seqInferredL2: "算法",
			}),
		]);
		assert.ok(aligned.includes("技术 · 算法（按岗位名对齐）"));
		const unaligned = html([
			seg({ kind: "external", seqL1: "", seqL2: "", seqL3: "" }),
		]);
		assert.ok(!unaligned.includes("按岗位名对齐"));
		assert.ok(html([seg()]).includes("<span>技术 · 算法</span>"));
	});
});
