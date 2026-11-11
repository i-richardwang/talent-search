/**
 * 选人导出的选择状态（`select`）：选中的是名单上那一行的快照，被筛掉的人仍算选中；名单换
 * 一份时快照跟着换；换一条记录清空。
 *
 * 姓名为虚构数据。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { opened, type Pick, select } from "#/routes/s/$turnId/-lib/picks";

const row = (rank: number, title: string | null = null) => ({
	pick: {
		dept: null,
		empId: `T000${rank}`,
		evidence: [],
		level: null,
		name: `样例${rank}`,
		rank,
		title,
	} satisfies Pick,
});

const FIRST = row(1);
const LIST = [FIRST, row(2), row(3), row(4)];
const TURN = "turn-a";

const ids = (state: ReturnType<typeof opened>) => [...state.picked.keys()];

describe("选择状态", () => {
	test("点一下选中名单上的人，再点一下取消；不在名单上的人点不中", () => {
		let state = select(opened(TURN, LIST), { empId: "T0002", type: "toggle" });
		assert.deepEqual(ids(state), ["T0002"]);
		state = select(state, { empId: "T0002", type: "toggle" });
		assert.deepEqual(ids(state), []);
		const same = select(state, { empId: "T0009", type: "toggle" });
		assert.equal(same, state);
	});

	test("名单换了一份：还在名单上的换成新的那一行，被筛掉的留着原来的样子", () => {
		let state = opened(TURN, LIST);
		state = select(state, { ids: ["T0001", "T0003"], type: "check" });
		const moved = row(3, "新岗位");
		const next = [moved, row(4)];
		state = select(state, { rows: next, turnId: TURN, type: "show" });
		assert.deepEqual(ids(state), ["T0001", "T0003"]);
		assert.equal(state.picked.get("T0003"), moved.pick);
		assert.equal(state.picked.get("T0001"), FIRST.pick);
	});

	test("勾选框只管名单上的人：被筛掉的已选人不因为没勾上而丢掉", () => {
		let state = opened(TURN, LIST);
		state = select(state, { ids: ["T0001", "T0002"], type: "check" });
		state = select(state, {
			rows: [row(2), row(3)],
			turnId: TURN,
			type: "show",
		});
		state = select(state, { ids: ["T0003"], type: "check" });
		assert.deepEqual(ids(state).sort(), ["T0001", "T0003"]);
	});

	test("选择全部：等着的只是下一份名单，再往后的不自动选", () => {
		let state = select(opened(TURN, LIST.slice(0, 2)), {
			more: true,
			type: "pickAll",
		});
		assert.deepEqual(ids(state), ["T0001", "T0002"]);
		state = select(state, { rows: LIST, turnId: TURN, type: "show" });
		assert.equal(state.picked.size, 4);
		state = select(state, {
			rows: [...LIST, row(5)],
			turnId: TURN,
			type: "show",
		});
		assert.equal(state.picked.has("T0005"), false);
	});

	test("清空取消等着的那一批", () => {
		let state = select(opened(TURN, LIST.slice(0, 2)), {
			more: true,
			type: "pickAll",
		});
		state = select(state, { type: "clear" });
		state = select(state, { rows: LIST, turnId: TURN, type: "show" });
		assert.equal(state.picked.size, 0);
	});

	test("连选把两人之间的都选中，已选的不取消", () => {
		let state = select(opened(TURN, LIST), { empId: "T0004", type: "toggle" });
		state = select(state, { from: 0, to: 2, type: "pickRange" });
		assert.deepEqual(ids(state).sort(), ["T0001", "T0002", "T0003", "T0004"]);
	});

	test("移除不要求那个人在名单上", () => {
		let state = select(opened(TURN, LIST), { empId: "T0001", type: "toggle" });
		state = select(state, { rows: [row(2)], turnId: TURN, type: "show" });
		state = select(state, { empId: "T0001", type: "remove" });
		assert.equal(state.picked.size, 0);
	});

	test("换一条记录就清空，选择全部等着的那一批也取消", () => {
		let state = select(opened(TURN, LIST.slice(0, 2)), {
			more: true,
			type: "pickAll",
		});
		state = select(state, { rows: LIST, turnId: "turn-b", type: "show" });
		assert.equal(state.picked.size, 0);
		assert.equal(state.sweeping, false);
		assert.equal(state.turnId, "turn-b");
	});
});
