/**
 * 选中人之后浮现的工具条。
 *
 * 三条约束：显示的数字等于选中人数；默认不展开人名（姓名会随选中人数增加不断
 * 挤压名单宽度，而名单才是用户正在读的内容），但要有一个钮点开看已选的人——选中
 * 记录按快照保存，改过筛选后有几个人不在名单上，没有这个入口就既无法核对也无法移除；
 * 一个人都没选时不渲染。动作是只有图标的钮，名字在 aria-label 上。
 *
 * 姓名为虚构数据。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PickDock } from "#/routes/s/$turnId/-components/pick-dock";
import type { Pick, Picks } from "#/routes/s/$turnId/-lib/picks";
import { visibleText } from "./render";

const pick = (name: string, rank: number): Pick => ({
	empId: `T000${rank}`,
	name,
	dept: null,
	title: null,
	level: null,
	rank,
	evidence: [],
});

const picks = (chosen: Pick[]): Picks => ({
	clear: () => {},
	picked: new Map(chosen.map((p) => [p.empId, p])),
	pickAll: () => {},
	pointAt: () => false,
	remove: () => {},
	rows: [],
	setShown: () => {},
	shownIds: chosen.map((p) => p.empId),
	shownPicked: chosen.map((p) => p.empId),
	toggle: () => {},
});

const markup = (chosen: Pick[]) =>
	renderToStaticMarkup(
		<PickDock
			loading={false}
			names={["算法"]}
			onAll={() => {}}
			picks={picks(chosen)}
			total={80}
		/>,
	);

describe("选择后浮起来的工具条", () => {
	test("显示人数，并给出两个动作", () => {
		const html = markup([pick("林岚", 1), pick("周予", 2)]);
		assert.match(visibleText(html), /已选\s*2\s*人/);
		assert.ok(html.includes('aria-label="清空已选"'), html);
		// 导出按钮自己带上人数：指针移上去之前就知道点下去会导出几个人
		assert.ok(html.includes('aria-label="导出 2 人"'), html);
	});

	test("默认只显示人数，点开才列出选了谁", () => {
		const html = markup([pick("林岚", 1)]);
		assert.doesNotMatch(visibleText(html), /林岚/);
		// 选中的是哪几个人、以及怎么移除其中一个，都在这个按钮后面
		assert.match(html, /<button[^>]*aria-label="已选的人"/);
	});

	test("一个都没选时不渲染", () => {
		// 选择有开始也有结束，只有中间这段需要汇总条。空着时摆一条
		// 「已选 0 人 · 清空 · 导出」，等于留一组既不可用也不会变化的按钮。
		// 它出现时不会挤动任何卡片：它固定在名单下沿，是绝对定位的。
		assert.equal(markup([]), "");
	});
});
