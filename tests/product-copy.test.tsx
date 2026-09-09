/**
 * 核心页面文案要从业务用户的任务出发，不把检索实现暴露成使用说明。
 *
 * 产品工作区只保留完成当前任务所需的信息，不用价值主张或口号替用户下结论。
 * 这几处分别是第一次进入、第一次看到结果、第一次学习证据点阵的入口；
 * 任一处退回「语料 / 受控字段」这套内部语言，整条体验就会
 * 要求用户先理解系统，再开始找人。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StrengthLegend } from "#/components/evidence";
import { ZeroState } from "#/routes/-components/zero-state";
import { scopeEntries } from "#/routes/-lib/scope-label";
import { QueryDeck } from "#/routes/s/$turnId/-components/query-deck";
import {
	ResultHeader,
	ResultList,
} from "#/routes/s/$turnId/-components/result-list";
import { emptyFacets } from "#/search/result";
import { visibleText } from "./render";

const seen = (node: React.ReactNode) => visibleText(renderToStaticMarkup(node));

describe("产品文案使用常规 SaaS 语言", () => {
	test("查询范围使用稳定的人话与顺序，不把存储值露给最近搜索", () => {
		const labels = scopeEntries({ level: ["P7"], kind: "external" }).map(
			(entry) => entry.label,
		);
		// 顺序就是维度表里的声明顺序，不是范围对象上碰巧的字段序
		assert.deepEqual(labels, ["当前职级 · P7", "入职前经历"]);
		assert.doesNotMatch(labels.join(" "), /external/);
	});

	test("首页不写口号、不写对话式提问，也不复述自己是干什么的", () => {
		const text = seen(<ZeroState error={null} onQuery={() => true} />);
		assert.doesNotMatch(text, /你想找什么样的人|找到合适的人|查看相关人选/);
		assert.doesNotMatch(text, /语料|受控字段/);
		/*
		 * 零态只有一个动作：把要找的人说出来。屏幕上除了输入框和几句可以照着
		 * 改的例子之外不该有别的小节——多一个小标题，那个动作就多一份被分掉的
		 * 注意力，而这一屏没有第二件值得做的事。
		 */
		assert.doesNotMatch(text, /最近搜索|常用方向|搜索示例|数据范围/);
		// 例子是整句，不是单个词：一句话里能放多个条件这件事只有它说得出来。
		assert.match(text, /做过.+、.+的人/);
	});

	test("结果数量使用中性状态，不暴露检索术语", () => {
		const text = seen(
			<ResultHeader
				loading={false}
				onChange={() => {}}
				order="relevance"
				planned
				strong={false}
				strongOn={0}
				terms={[
					{
						term: "算法",
						members: [{ text: "算法", tier: "said" }],
						mode: "must",
					},
				]}
				total={12}
			/>,
		);
		// 数和单位挨着，中间不许插别的东西。不要求「共」字：它是名单的表头
		// （12 / 人 / 按相关度排序），不是句子里的一截。
		assert.match(text, /12\s*人/);
		// 排序依据常驻：一张排过序的表必须说出自己按什么排，否则「从上往下看」
		// 这个动作没有依据。它不该只在结果被截断时才出现一次。
		assert.match(text, /按相关度排序/);
		assert.doesNotMatch(text, /找到 12 人|命中 12 人/);
	});

	test("理解失败必须说出来，并且给出一步可执行的动作", () => {
		/*
		 * 一句话只有模型能读成条件。它失败时记录停在「待理解」，屏幕上必须是
		 * 一条看得见的错误加一个重试——不是一份空名单，空名单在这个界面里的
		 * 意思是「没有这样的人」。
		 */
		const text = seen(
			<QueryDeck
				error="没能理解这句话，请重试或换一种说法。"
				interpreting={false}
				onChangeSpec={() => {}}
				onQuery={() => true}
				onRetry={() => {}}
				ref={{ current: null }}
				rawText="最好懂算法、不要实习"
				spec={{ requirements: [], scope: {}, notices: [] }}
			/>,
		);
		assert.match(text, /没能理解这句话/);
		assert.match(text, /重试/);
		assert.doesNotMatch(text, /降级|规则解析|模型/, "别把内部实现讲给用户听");
	});

	test("理解中显示的是用户自己那句话，不是一排占位方块", () => {
		const text = seen(
			<QueryDeck
				error={null}
				interpreting
				onChangeSpec={() => {}}
				onQuery={() => true}
				ref={{ current: null }}
				rawText="做过线下渠道运营、带过团队的人"
				spec={{ requirements: [], scope: {}, notices: [] }}
			/>,
		);
		assert.match(text, /做过线下渠道运营、带过团队的人/);
		assert.match(text, /正在理解/);
	});

	test("一个人都没有时不报数，空态自己会说", () => {
		/*
		 * 「0 人」摆在空态上面是同一件事的第一遍，而这个判断留在调用点
		 * （result-list.tsx 的空态分支干脆不写表头），不是一条藏在 ResultHeader
		 * 里的守卫——所以它只能在这里有断言。
		 */
		const text = seen(
			<ResultList
				canMore={false}
				empId={undefined}
				growing={false}
				loading={false}
				onChange={() => {}}
				onEditQuery={() => {}}
				onMore={() => {}}
				onReviseQuery={() => {}}
				strong={false}
				strongOn={0}
				outcome={{
					order: "relevance",
					terms: [
						{
							term: "量子炼金",
							members: [{ text: "量子炼金", tier: "said" }],
							mode: "must",
						},
					],
					results: [],
					facets: emptyFacets(),
					total: 0,
					empty: { kind: "unmet" },
				}}
				spec={{
					requirements: [
						{ members: [{ text: "量子炼金", tier: "said" }], mode: "must" },
					],
					scope: {},
					notices: [],
				}}
				turnId="t1"
			/>,
		);
		// 先确认画出来的确实是空态那一支：两条 doesNotMatch 在一片空白上也成立
		assert.match(text, /没有符合全部必选条件的结果/);
		assert.doesNotMatch(text, /0\s*人/);
		assert.doesNotMatch(text, /按相关度排序/);
	});

	test("点阵图例说明判断依据，不要求用户理解字段治理", () => {
		const text = seen(<StrengthLegend />);
		assert.match(text, /岗位或序列/);
		assert.match(text, /部门或公司/);
		assert.match(text, /简历原文/);
		assert.doesNotMatch(text, /受控字段|无校验|可直接确认/);
	});
});
