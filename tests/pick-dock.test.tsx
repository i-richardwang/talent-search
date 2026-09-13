/**
 * 挑上人之后浮起来的那一小块。
 *
 * 三件事要守住：报的数就是挑上的人数；**不把挑了谁再列一遍**（名单上那几个打上
 * 勾的块已经在说了，这里再摆一排姓名会随着挑的人变多把名单越挤越窄，而那正是人
 * 正在读的东西）；以及一个人都没挑的时候它根本不在——空着的时候它那三个词一个
 * 也按不动。
 *
 * 姓名是编的。
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
	picking: true,
	rows: [],
	setShown: () => {},
	shownIds: chosen.map((p) => p.empId),
	shownPicked: chosen.map((p) => p.empId),
	start: () => {},
	toggle: () => {},
});

const markup = (chosen: Pick[]) =>
	renderToStaticMarkup(
		<PickDock picks={picks(chosen)} names={["算法"]} total={80} />,
	);

describe("挑人那块浮起来的东西", () => {
	test("报数，并且给得出两个动作", () => {
		const text = visibleText(markup([pick("林岚", 1), pick("周予", 2)]));
		assert.match(text, /已选\s*2\s*人/);
		assert.ok(text.includes("清空"), text);
		// 导出那一颗自己报数：手指落上去之前就知道这一下会导出几个人
		assert.match(text, /导出\s*2\s*人/);
	});

	test("不列挑了谁", () => {
		assert.doesNotMatch(visibleText(markup([pick("林岚", 1)])), /林岚/);
	});

	test("一个都没挑的时候它不在", () => {
		// 挑人是有开始有结束的一件活，中间那段才需要一个收口。空着的时候摆一条
		// 「已选 0 人 · 清空 · 导出」，是在屏幕上留一样按不动也不会变的东西。
		// 它冒出来不会顶动任何一块卡片：它吸在名单下沿，而框是绝对定位的。
		assert.equal(markup([]), "");
	});
});
