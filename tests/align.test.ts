/**
 * 序列对齐：树从哪来、收窄只认树上的一对、哪些段会去问、缓存身份随树变。
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import type { ExperienceRow } from "#/corpus/pipeline";
import { answerChat, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { align, conform, seqTree, systemPrompt } = await import(
	"#/corpus/align"
);
const { UNEMPLOYED } = await import("#/corpus/pipeline");

const quiet = () => {};

function segment(row: Partial<ExperienceRow>): ExperienceRow {
	return {
		emp_id: "E1",
		kind: "internal",
		start_date: "2019-01-01",
		end_date: "2020-01-01",
		org: "",
		org_path: "",
		org_meta: null,
		title: "",
		seq_l1: "",
		seq_l2: "",
		seq_l3: "",
		seq_inferred_l1: "",
		seq_inferred_l2: "",
		level: "",
		description: "",
		months: 12,
		...row,
	};
}

/** 两段登记了序列的公司内经历，加上给定的（岗位，描述）入职前段。 */
function corpus(...external: [string, string][]): ExperienceRow[] {
	return [
		segment({
			org: "平台技术部",
			title: "算法工程师",
			seq_l1: "技术",
			seq_l2: "算法",
		}),
		segment({
			org: "渠道部",
			title: "渠道运营",
			seq_l1: "运营",
			seq_l2: "渠道运营",
		}),
		segment({ org: "渠道部", title: "实习生", seq_l1: "运营", seq_l2: "" }),
		...external.map(([title, description]) =>
			segment({ kind: "external", org: "云枢智能", title, description }),
		),
	];
}

describe("序列树", () => {
	test("只取公司内经历里两级都登记了的那些对", () => {
		assert.deepEqual(seqTree(corpus(["算法工程师", ""])), [
			["技术", "算法"],
			["运营", "渠道运营"],
		]);
	});

	test("提示词把每一对都列出来", () => {
		const prompt = systemPrompt([
			["技术", "算法"],
			["运营", "渠道运营"],
		]);
		assert.ok(prompt.includes("技术 · 算法"));
		assert.ok(prompt.includes("运营 · 渠道运营"));
	});
});

describe("收窄", () => {
	const tree: [string, string][] = [["技术", "算法"]];

	test("树上的一对，前后空白不算数", () => {
		assert.deepEqual(conform({ l1: " 技术", l2: "算法 " }, tree), [
			"技术",
			"算法",
		]);
	});

	test("其余组合一律视为没对上", () => {
		for (const raw of [
			{ l1: "技术", l2: "推荐" },
			{ l1: "技术", l2: "" },
			{ l1: "", l2: "" },
			{ l1: "技术" },
			"技术 · 算法",
			null,
		])
			assert.deepEqual(conform(raw, tree), ["", ""]);
	});
});

describe("对齐", () => {
	test("只问入职前的非待业段，结果写进推断的两列", async () => {
		const rows = corpus(
			["推荐算法工程师", "负责召回"],
			[UNEMPLOYED, ""],
			["厨师", ""],
		);
		const asked: string[] = [];
		const restore = answerChat((_system, prompt) => {
			asked.push(prompt);
			return prompt.includes("推荐")
				? { l1: "技术", l2: "算法" }
				: { l1: "", l2: "" };
		});
		const out = await align(rows, seqTree(rows), quiet);
		restore();

		assert.equal(asked.length, 2);
		assert.deepEqual(
			out.map((row) => [row.seq_inferred_l1, row.seq_inferred_l2]),
			[
				["", ""],
				["", ""],
				["", ""],
				["技术", "算法"],
				["", ""],
				["", ""],
			],
		);
		// 登记的三列不被碰
		assert.deepEqual(
			out.slice(3).map((row) => row.seq_l1),
			["", "", ""],
		);
	});

	test("树是空的时候不请求端点", async () => {
		const rows = corpus(["算法工程师", ""]).filter(
			(row) => row.kind === "external",
		);
		const restore = answerChat(() => {
			throw new Error("不该打端点");
		});
		const out = await align(rows, seqTree(rows), quiet);
		restore();

		assert.deepEqual(
			out.map((row) => row.seq_inferred_l1),
			[""],
		);
	});

	test("树变了就重新问：树写在提示词里，也就在缓存的键里", async () => {
		const rows = corpus(["数据分析师", ""]);
		let asked = 0;
		const restore = answerChat(() => {
			asked++;
			return { l1: "", l2: "" };
		});
		await align(rows, seqTree(rows), quiet);
		await align(rows, seqTree(rows), quiet);
		assert.equal(asked, 1);

		const grown = [...rows, segment({ seq_l1: "技术", seq_l2: "数据" })];
		await align(grown, seqTree(grown), quiet);
		restore();
		assert.equal(asked, 2);
	});
});
