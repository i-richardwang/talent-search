/**
 * 序列对齐：树从哪来、校验只接受树上的一对、哪些段会去问、缓存身份随树变。
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
const { extract, SYSTEM: EXTRACT_SYSTEM } = await import("#/corpus/extract");
const { UNEMPLOYED } = await import("#/corpus/pipeline");

const quiet = () => {};

function segment(row: Partial<ExperienceRow>): ExperienceRow {
	return {
		emp_id: "E1",
		kind: "internal",
		unemployed: false,
		start_date: "2019-01-01",
		end_date: "2020-01-01",
		company: "",
		department: "",
		department_path: "",
		company_meta: null,
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
			department: "平台技术部",
			title: "算法工程师",
			seq_l1: "技术",
			seq_l2: "算法",
		}),
		segment({
			department: "渠道部",
			title: "渠道运营",
			seq_l1: "运营",
			seq_l2: "渠道运营",
		}),
		segment({
			department: "渠道部",
			title: "实习生",
			seq_l1: "运营",
			seq_l2: "",
		}),
		...external.map(([title, description]) =>
			segment({
				kind: "external",
				unemployed: title === UNEMPLOYED,
				company: "云枢智能",
				title,
				description,
			}),
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
		assert.ok(prompt.includes("算法（技术）"));
		assert.ok(prompt.includes("渠道运营（运营）"));
	});
});

describe("校验", () => {
	const tree: [string, string][] = [["技术", "算法"]];

	test("树上的一行，前后空白不算数", () => {
		assert.deepEqual(conform({ seq: " 算法（技术） " }, tree), [
			"技术",
			"算法",
		]);
	});

	test("两级均空是合法的无法对齐", () => {
		assert.deepEqual(conform({ seq: "" }, tree), ["", ""]);
	});

	test("序列名保留登记字面，不折叠全半角", () => {
		assert.deepEqual(
			conform({ seq: "算法Ｂ（技术Ａ）" }, [["技术Ａ", "算法Ｂ"]]),
			["技术Ａ", "算法Ｂ"],
		);
	});

	test("无效回答与合法的无法对齐分开", () => {
		for (const raw of [
			{ seq: "推荐（技术）" },
			{ seq: "技术" },
			{ seq: 9 },
			{ l1: "技术", l2: "算法" },
			"算法（技术）",
			null,
		])
			assert.equal(conform(raw, tree), null);
	});
});

describe("对齐", () => {
	test("独立选择对齐模型，未配置时沿用抽取模型，抽取不受影响", async () => {
		const original = process.env.ALIGN_MODEL;
		const rows = corpus(["模型分工样例", "合成经历描述"]);
		const restore = answerChat((system, _prompt, request) => {
			if (system === EXTRACT_SYSTEM)
				return {
					items: [
						{
							text: request.model === "fake" ? "数据分析" : "错误模型",
							depth: "做过",
						},
					],
				};
			return {
				seq:
					request.model === "align-fake" ? "算法（技术）" : "渠道运营（运营）",
			};
		});
		try {
			for (const [model, expected] of [
				[undefined, "渠道运营"],
				[" align-fake ", "算法"],
				[" ", "渠道运营"],
			] as const) {
				if (model === undefined) delete process.env.ALIGN_MODEL;
				else process.env.ALIGN_MODEL = model;
				assert.equal(
					(await align(rows, seqTree(rows), quiet)).at(-1)?.seq_inferred_l2,
					expected,
				);
				assert.deepEqual((await extract(rows, quiet)).at(-1), {
					status: "done",
					value: { items: [{ text: "数据分析", engagement: "做过" }] },
				});
			}
		} finally {
			if (original === undefined) delete process.env.ALIGN_MODEL;
			else process.env.ALIGN_MODEL = original;
			restore();
		}
	});

	test("登记的全角序列名可以原样对齐", async () => {
		const rows = [
			segment({ seq_l1: "技术Ａ", seq_l2: "算法Ｂ" }),
			segment({ kind: "external", title: "全角序列对齐样例" }),
		];
		const restore = answerChat(() => ({ seq: "算法Ｂ（技术Ａ）" }));
		try {
			assert.equal(
				(await align(rows, seqTree(rows), quiet))[1]?.seq_inferred_l2,
				"算法Ｂ",
			);
		} finally {
			restore();
		}
	});

	for (const [label, answer] of [
		["树外序列", { seq: "推荐（技术）" }],
		["只有一级", { seq: "技术" }],
		["跨行组合", { seq: "渠道运营（技术）" }],
	] as const) {
		test(`${label}不缓存，下一次成功后才复用回答`, async () => {
			const rows = corpus(["算法工程师", `${label}重试样例`]);
			const tree = seqTree(rows);
			let calls = 0;
			const restore = answerChat(() => {
				calls++;
				return calls === 1 ? answer : { seq: "算法（技术）" };
			});
			try {
				assert.equal((await align(rows, tree, quiet)).at(-1), null);
				const retried = await align(rows, tree, quiet);
				assert.equal(retried.at(-1)?.seq_inferred_l2, "算法");
				assert.deepEqual(await align(rows, tree, quiet), retried);
				assert.equal(calls, 2);
			} finally {
				restore();
			}
		});
	}

	test("只问入职前的非待业段，结果写进推断的两列", async () => {
		const rows = corpus(
			["推荐算法工程师", "负责召回"],
			[UNEMPLOYED, ""],
			["厨师", ""],
		);
		const asked: string[] = [];
		const restore = answerChat((_system, prompt) => {
			asked.push(prompt);
			return prompt.includes("推荐") ? { seq: "算法（技术）" } : { seq: "" };
		});
		const out = await align(rows, seqTree(rows), quiet);
		restore();

		assert.equal(asked.length, 2);
		assert.deepEqual(
			out.map((row) => [row?.seq_inferred_l1, row?.seq_inferred_l2]),
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
			out.slice(3).map((row) => row?.seq_l1),
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
			out.map((row) => row?.seq_inferred_l1),
			[""],
		);
	});

	test("树变了就重新问：树写在提示词里，也就在缓存的键里", async () => {
		const rows = corpus(["数据分析师", ""]);
		let asked = 0;
		const restore = answerChat(() => {
			asked++;
			return { seq: "" };
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
