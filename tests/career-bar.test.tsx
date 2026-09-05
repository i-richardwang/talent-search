/**
 * 职业轨迹条的几何。
 *
 * 这一份非测不可：带子上的每一个数都是算出来的百分比，算错了页面上只是
 * 「看起来有点怪」——没有任何断言会红，tsc / biome / build 全绿，而少画一段
 * 经历和画错一段经历在视觉上几乎一样。真正咬人的是重叠：入职前经历与在职
 * 经历来自两张表，同一段时间各登记一条是常态，单轨绝对定位下后画的会把前
 * 一条整个盖住。所以分轨那一条单独钉死。
 *
 * 姓名、工号、公司名全是编的，和人才库无关。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CareerBar, packLanes, ym } from "#/components/career-bar";
import { experience, hit } from "./rows";

const exp = (id: number, startDate: string, endDate: string | null) =>
	experience({ id, startDate, endDate });

/** 渲染出来的每个色块，按 DOM 顺序 */
function blocks(html: string) {
	return [...html.matchAll(/<button[^>]*style="([^"]*)"[^>]*>/g)].map((m) => {
		const style = Object.fromEntries(
			(m[1] ?? "")
				.split(";")
				.filter(Boolean)
				.map((d) => d.split(":").map((s) => s.trim()) as [string, string]),
		);
		return style;
	});
}

describe("年月折算", () => {
	test("同一年内相差几个月就是几", () => {
		assert.equal(ym("2020-07-01") - ym("2020-03-15"), 4);
	});

	test("跨年按 12 个月算，日不参与", () => {
		assert.equal(ym("2021-03-31") - ym("2020-03-01"), 12);
	});
});

describe("重叠分轨", () => {
	test("不重叠的段全在第一条轨上——大多数人只该看到一条线", () => {
		const lanes = packLanes([
			{ start: 0, end: 10 },
			{ start: 10, end: 20 },
			{ start: 24, end: 30 },
		]);
		assert.deepEqual(lanes, [0, 0, 0]);
	});

	test("同时开始的两段分到两条轨，不会互相盖住", () => {
		const lanes = packLanes([
			{ start: 0, end: 40 },
			{ start: 0, end: 48 },
		]);
		assert.deepEqual(lanes, [0, 1]);
	});

	test("腾出来的轨会被复用，不是每重叠一次就多一条", () => {
		const lanes = packLanes([
			{ start: 0, end: 10 },
			{ start: 5, end: 15 },
			{ start: 20, end: 30 },
		]);
		// 第三段和前两段都不重叠，回到第一条轨
		assert.deepEqual(lanes, [0, 1, 0]);
	});

	test("输入顺序不影响结果：轨号跟着时间走，不跟着数组下标走", () => {
		const spans = [
			{ start: 20, end: 30 },
			{ start: 0, end: 10 },
		];
		assert.deepEqual(packLanes(spans), [0, 0]);
	});
});

describe("带子的几何", () => {
	const rows = [
		exp(1, "2016-01-01", "2020-01-01"),
		exp(2, "2020-01-01", "2024-01-01"),
	];

	test("起点贴左边，跨度按真实月数摊开", () => {
		const html = renderToStaticMarkup(
			<CareerBar hireDate={null} hitIndex={new Map()} rows={rows} />,
		);
		const [a, b] = blocks(html);
		assert.equal(a?.left, "0%");
		// 两段各占一半：2016-01 到 2024-01 共 96 个月，每段 48 个月
		assert.equal(a?.width, "50%");
		assert.equal(b?.left, "50%");
	});

	test("命中段占满整条轨，未命中段只是中间一道细线", () => {
		const html = renderToStaticMarkup(
			<CareerBar
				hireDate={null}
				hitIndex={new Map([[1, [hit({ route: "seq" })]]])}
				rows={rows}
			/>,
		);
		const [matched, missed] = blocks(html);
		assert.equal(matched?.height, "8px");
		assert.equal(missed?.height, "2px");
		// 细线在轨内居中，不是贴着轨顶
		assert.equal(missed?.top, "3px");
	});

	test("受控字段命中才是绿的，未命中段永远不上色", () => {
		const html = renderToStaticMarkup(
			<CareerBar
				hireDate={null}
				hitIndex={new Map([[1, [hit({ route: "seq" })]]])}
				rows={rows}
			/>,
		);
		const classes = [...html.matchAll(/<button[^>]*class="([^"]*)"/g)].map(
			(m) => m[1] ?? "",
		);
		assert.ok(classes[0]?.includes("bg-success"));
		assert.ok(!classes[1]?.includes("bg-success"));
	});

	test("简历原文那一路不是绿的——强度编码在这里和点阵同义", () => {
		const html = renderToStaticMarkup(
			<CareerBar
				hireDate={null}
				hitIndex={new Map([[1, [hit({ route: "description" })]]])}
				rows={rows}
			/>,
		);
		const first = html.match(/<button[^>]*class="([^"]*)"/)?.[1] ?? "";
		assert.ok(!first.includes("bg-success"));
		assert.ok(first.includes("ring"));
	});

	test("入职线落在它该在的比例上", () => {
		const html = renderToStaticMarkup(
			<CareerBar hireDate="2020-01-01" hitIndex={new Map()} rows={rows} />,
		);
		assert.ok(html.includes("bg-foreground"));
		assert.match(html, /入职 2020/);
	});

	test("入职日落在经历跨度之外时不画线，也不画标签", () => {
		const html = renderToStaticMarkup(
			<CareerBar hireDate="1999-01-01" hitIndex={new Map()} rows={rows} />,
		);
		assert.ok(!html.includes("bg-foreground"));
		assert.ok(!html.includes("入职"));
	});

	test("单段、同一年之内也不会除以零", () => {
		const html = renderToStaticMarkup(
			<CareerBar
				hireDate={null}
				hitIndex={new Map()}
				rows={[exp(9, "2024-02-01", "2024-05-01")]}
			/>,
		);
		assert.ok(!html.includes("NaN"));
	});

	test("一段经历都没有就整块不画", () => {
		const html = renderToStaticMarkup(
			<CareerBar hireDate="2020-01-01" hitIndex={new Map()} rows={[]} />,
		);
		assert.equal(html, "");
	});
});
