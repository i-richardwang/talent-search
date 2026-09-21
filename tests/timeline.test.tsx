import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Timeline } from "#/components/timeline";
import type { Experience } from "#/db/schema";
import { experience as seg } from "./rows";

const html = (rows: Experience[]) =>
	renderToStaticMarkup(
		<Timeline hitIndex={new Map()} names={[]} rows={rows} />,
	);

describe("时间轴卡片内容", () => {
	test("入职前经历显示日期、公司属性和自述", () => {
		const s = html([
			seg({
				kind: "external",
				description: "负责渠道拓展与团队管理。",
				seqL1: "",
				seqL2: "",
				seqL3: "",
				orgMeta: { company_tag: "某档", industry: "某行业", nature: "某性质" },
			}),
		]);
		assert.ok(s.includes("入职前"));
		assert.ok(s.includes("某档 · 某行业 · 某性质"));
		assert.ok(s.includes("负责渠道拓展与团队管理。"));
	});

	test("公司内的段不显示「入职前」", () => {
		assert.ok(!html([seg()]).includes("入职前"));
	});

	test("入职前的段写的是推断的序列并标明；登记的序列照原样写", () => {
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
		assert.ok(aligned.includes("技术 · 算法（推断）"));
		const unaligned = html([
			seg({ kind: "external", seqL1: "", seqL2: "", seqL3: "" }),
		]);
		assert.ok(!unaligned.includes("（推断）"));
		assert.ok(html([seg()]).includes("<span>技术 · 算法</span>"));
	});
});
