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
import { QueryDeck } from "#/routes/s/$turnId/-components/query-deck";
import {
	ResultHeader,
	ResultList,
} from "#/routes/s/$turnId/-components/result-list";
import type { Picks } from "#/routes/s/$turnId/-lib/picks";
import type { Condition } from "#/search/condition";
import { conditionLabel, partLabel } from "#/search/condition-label";
import { routeLabel } from "#/search/evidence";
import { emptyFacets } from "#/search/result";
import { ROUTE_ORDER } from "#/search/weights";
import { person } from "./conditions";
import { visibleText } from "./render";

const seen = (node: React.ReactNode) => visibleText(renderToStaticMarkup(node));

/** 这几条测的是文案，不是选择。一份谁也没选的就够。 */
const NO_PICKS: Picks = {
	clear: () => {},
	picked: new Map(),
	picking: false,
	pickAll: () => {},
	remove: () => {},
	rows: [],
	setShown: () => {},
	shownIds: [],
	shownPicked: [],
	start: () => {},
	toggle: () => {},
};

describe("产品文案使用常规 SaaS 语言", () => {
	test("条件使用稳定的人话，不把存储值露给最近搜索", () => {
		// 几个取值只显示代表词：其余的收在菜单里，chip 上有「还有」的记号
		assert.deepEqual(
			[
				conditionLabel(person("level", ["P7", "P8"])),
				conditionLabel(person("education", "硕士")),
				conditionLabel(person("recruitment", "社招")),
				conditionLabel(person("school", "清华")),
			],
			["当前职级 · P7", "学历 · 硕士", "招聘渠道 · 社招", "学校 · 清华"],
		);
		// 经历主张按表述顺序排列：什么时候、在哪一档、在哪、做过什么、多久
		const claim: Condition = {
			about: "experience",
			mode: "must",
			what: ["增长", "用户增长"],
			org: ["字节"],
			companyTag: ["大厂"],
			kind: "external",
			minMonths: 24,
		};
		assert.equal(
			conditionLabel(claim),
			"入职前经历 · 大厂 · 字节 · 增长 · ≥ 2 年",
		);
		assert.doesNotMatch(conditionLabel(claim), /external|单段|公司档/);
		assert.equal(
			conditionLabel({ about: "experience", mode: "boost", org: ["字节"] }),
			"字节",
		);
		assert.equal(
			conditionLabel({ about: "experience", mode: "must", what: ["算法"] }),
			"算法",
		);
		// 菜单里的各项出现在已经写明了是哪条条件的地方，只显示这一项本身
		assert.equal(
			partLabel(person("level", ["P7", "P8"]), { key: "values", value: "P8" }),
			"P8",
		);
		assert.equal(
			partLabel(claim, { key: "kind", value: "external" }),
			"入职前经历",
		);
		assert.equal(
			partLabel(claim, { key: "minMonths", value: 24 }),
			"累计 ≥ 2 年",
		);
		assert.equal(
			partLabel(claim, { key: "what", value: "用户增长" }),
			"用户增长",
		);
	});

	test("首页不写口号、不写对话式提问，也不复述自己是干什么的", () => {
		const html = renderToStaticMarkup(
			<ZeroState error={null} onQuery={() => true} />,
		);
		const text = visibleText(html);
		assert.doesNotMatch(text, /你想找什么样的人|找到合适的人|查看相关人选/);
		assert.doesNotMatch(text, /语料|受控字段/);
		/*
		 * 零态只有一个动作：把要找的人说出来。屏幕上除了输入框和几句可以照着
		 * 改的例子之外不该有别的小节——多一个小标题，那个动作就多一份被分掉的
		 * 注意力，而这一屏没有第二件值得做的事。
		 */
		assert.doesNotMatch(text, /最近搜索|常用方向|搜索示例|数据范围/);
		assert.match(html, /placeholder="输入人选要求：岗位、经历、技能"/);
		assert.doesNotMatch(html, /条件可以放好几个|用一句话说/);
		// 例子是整句，不是单个词：一句话里能放多个条件这件事只有它说得出来。
		assert.match(text, /做过.+、.+的人/);
	});

	test("结果数量使用中性状态，不暴露检索术语", () => {
		const text = seen(
			<ResultHeader
				loading={false}
				onPicking={() => {}}
				order="evidence"
				pickable
				picking={false}
				planned
				claims={[{ about: "experience", mode: "must", what: ["算法"] }]}
				total={12}
			/>,
		);
		// 数和单位挨着，中间不能插别的东西。不要求「共」字：它是名单的表头
		// （12 / 人 / 按证据排序），不是句子里的一截。
		assert.match(text, /12\s*人/);
		// 排序依据常驻：一张排过序的表必须说出自己按什么排，否则「从上往下看」
		// 这个动作没有依据。它不该只在结果被截断时才出现一次。
		assert.match(text, /按证据排序/);
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
				spec={{ conditions: [] }}
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
				spec={{ conditions: [] }}
			/>,
		);
		assert.match(text, /做过线下渠道运营、带过团队的人/);
		assert.match(text, /正在理解/);
	});

	test("一个人都没有时不显示人数", () => {
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
				onAll={() => {}}
				onChange={() => {}}
				onEditQuery={() => {}}
				onMore={() => {}}
				onReviseQuery={() => {}}
				picks={NO_PICKS}
				outcome={{
					order: "evidence",
					claims: [{ about: "experience", mode: "must", what: ["量子炼金"] }],
					results: [],
					facets: emptyFacets(),
					total: 0,
					empty: { kind: "unmet" },
				}}
				spec={{
					conditions: [
						{ about: "experience", mode: "must", what: ["量子炼金"] },
					],
				}}
				turnId="t1"
			/>,
		);
		// 先确认画出来的确实是空态那一支：两条 doesNotMatch 在一片空白上也成立
		assert.match(text, /没有同时满足必须条件的人/);
		assert.doesNotMatch(text, /0\s*人/);
		assert.doesNotMatch(text, /按证据排序/);
	});

	test("点阵图例说明判断依据，不要求用户理解字段治理", () => {
		const text = seen(<StrengthLegend />);
		assert.match(text, /岗位或序列/);
		assert.match(text, /部门或公司/);
		// 档名说的是「谁写的」；「简历原文」是路的名字，只指还没读过的段
		assert.match(text, /简历自述/);
		assert.doesNotMatch(text, /受控字段|可直接确认/);
		assert.equal(routeLabel("skill"), "技能");
		assert.equal(routeLabel("did"), "");
		assert.equal(routeLabel(null), "任职");
		assert.doesNotMatch(
			ROUTE_ORDER.map(routeLabel).join(" "),
			/能力词|做过的事|工作内容/,
		);
	});
});
