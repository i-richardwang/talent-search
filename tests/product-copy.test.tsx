/**
 * 核心页面文案要从业务用户的任务出发，不把检索实现暴露成使用说明。
 *
 * 产品工作区只保留完成当前任务所需的信息，不用价值主张或口号替用户下结论。
 * 这几处分别是第一次进入、第一次看到结果、第一次学习证据点阵的入口；
 * 任一处退回「语料 / 概念词 / 受控字段 / 命中」这套内部语言，整条体验就会
 * 要求用户先理解系统，再开始找人。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StrengthLegend } from "#/components/evidence";
import { QueryDeck } from "#/routes/-components/query-deck";
import { ResultHeader } from "#/routes/-components/result-list";
import { ZeroState } from "#/routes/-components/zero-state";
import { filterFields } from "#/routes/-lib/filters";
import { emptyFacets } from "#/search/result";
import { visibleText } from "./render";

const seen = (node: React.ReactNode) => visibleText(renderToStaticMarkup(node));

describe("产品文案使用常规 SaaS 语言", () => {
	test("首页使用功能名称，不写口号或对话式提问", () => {
		const text = seen(
			<ZeroState
				error={null}
				onQuery={() => true}
				overview={{ people: 12, segments: 34, seqs: ["算法"] }}
				pending={null}
				recent={[]}
			/>,
		);
		assert.match(text, /搜索人才/);
		assert.doesNotMatch(text, /你想找什么样的人|找到合适的人|查看相关人选/);
		assert.match(text, /数据范围：\s*12 名员工 · 34 段经历/);
		assert.match(text, /常用方向/);
		assert.match(text, /搜索示例/);
		assert.doesNotMatch(text, /语料|概念词|受控字段/);
	});

	test("结果数量使用中性状态，不暴露检索术语", () => {
		const text = seen(
			<ResultHeader
				loading={false}
				terms={[{ term: "算法", effective: "算法", mode: "must" }]}
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

	test("降级必须说出来，并且给出一步可执行的动作", () => {
		/*
		 * 模型不可用时服务端退回本地规则解析，而规则解析读不出语气：
		 * 「最好」「不要」会被一律判成必须条件。结果是错的而 chips 看起来正常，
		 * 所以这一句是「不静默降级」这条产品原则唯一的落点。
		 */
		const text = seen(
			<QueryDeck
				chips={[{ term: "算法", mode: "must" }]}
				degraded
				error={null}
				interpreting={false}
				onChangeQuery={() => {}}
				onChangeView={() => {}}
				onQuery={() => true}
				inputRef={{ current: null }}
				fields={filterFields(emptyFacets(), {})}
				strongCount={0}
				view={{}}
				onReinterpret={() => {}}
				rawText="最好懂算法、不要实习"
				terms={[{ term: "算法", effective: "算法", mode: "must" }]}
			/>,
		);
		assert.match(text, /未能识别这句话里的语气/);
		assert.match(text, /重新理解/);
		assert.doesNotMatch(text, /降级|规则解析|模型/, "别把内部实现讲给用户听");
	});

	test("理解中显示的是用户自己那句话，不是一排占位方块", () => {
		const text = seen(
			<QueryDeck
				chips={[]}
				degraded={false}
				error={null}
				interpreting
				onChangeQuery={() => {}}
				onChangeView={() => {}}
				onQuery={() => true}
				inputRef={{ current: null }}
				fields={filterFields(emptyFacets(), {})}
				strongCount={0}
				view={{}}
				rawText="做过线下渠道运营、带过团队的人"
				terms={[]}
			/>,
		);
		assert.match(text, /做过线下渠道运营、带过团队的人/);
		assert.match(text, /正在理解/);
	});

	test("点阵图例说明判断依据，不要求用户理解字段治理", () => {
		const text = seen(<StrengthLegend />);
		assert.match(text, /岗位或序列/);
		assert.match(text, /部门或公司/);
		assert.match(text, /简历原文/);
		assert.doesNotMatch(text, /受控字段|无校验|可直接确认/);
	});
});
