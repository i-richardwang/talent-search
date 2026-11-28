import type { QueryCondition } from "#/search/query";
import type { ConditionExplained } from "#/server/explain";

/*
 * 搜索条件点开后的详情：几种典型的条件，和服务端照条件解析出来的样子一样（`server/explain.ts`）。
 * 公司、部门、取值全是编的，和人才库无关；类型都从产品代码导入。
 */

type Sample = {
	title: string;
	description: string;
	condition: QueryCondition;
	explained: ConditionExplained;
};

export const EXPLAIN_SAMPLES: Sample[] = [
	{
		title: "工作内容加几种经历",
		description:
			"名称说的是一件事，点开看它实际要什么：工作内容一句一行，算的打勾、不算的打叉；经历范围一种一张卡，卡头是经历的来源，卡与卡之间是「或」。同一属性的几个取值合成一行。",
		condition: {
			from: "experience",
			id: "sample-ops",
			params: { d1: "%本地生活%", d2: "%外卖%" },
			where:
				"(e.kind = 'external' and ('到店与本地生活' = any(e.main_industries) or '外卖' = any(e.main_industries))) or (e.kind = 'internal' and (e.department_path ilike :d1 or e.department_path ilike :d2))",
			label: "在主营本地生活或外卖的公司做运营",
			mode: "must",
			seek: {
				patterns: ["运营"],
				criterion:
					"本人做运营：商家运营、用户运营、活动运营这些运营岗位都算。销售、客服、产品经理不算；只做配送调度的也不算运营。",
			},
		},
		explained: {
			work: {
				criterion:
					"本人做运营：商家运营、用户运营、活动运营这些运营岗位都算。销售、客服、产品经理不算；只做配送调度的也不算运营。",
			},
			months: null,
			options: [
				{
					lead: "外部经历",
					rows: [
						{
							field: "外部行业",
							kind: "fact",
							value: [
								{ tag: "到店与本地生活" },
								{ word: "/" },
								{ tag: "外卖" },
							],
						},
					],
				},
				{
					lead: "公司内经历",
					rows: [
						{
							field: "部门路径",
							kind: "fact",
							value: [
								{ word: "含" },
								{ tag: "本地生活" },
								{ word: "/" },
								{ tag: "外卖" },
							],
						},
					],
				},
			],
		},
	},
	{
		title: "背景条件",
		description:
			"没写做过什么的条件只有经历范围：一张卡里几行都要满足；设了累计时长的另起一节。",
		condition: {
			from: "experience",
			id: "sample-big",
			params: { tag: "头部大厂", t: "%实习%" },
			where:
				"e.kind = 'external' and e.company_tag = :tag and e.title not ilike :t",
			label: "在头部大厂待过 3 年以上",
			mode: "boost",
			minMonths: 36,
		},
		explained: {
			work: null,
			months: 36,
			options: [
				{
					lead: "外部经历",
					rows: [
						{ field: "外部公司", kind: "fact", value: [{ tag: "头部大厂" }] },
						{
							field: "岗位",
							kind: "fact",
							value: [{ word: "不含" }, { tag: "实习" }],
						},
					],
				},
			],
		},
	},
	{
		title: "人的条件",
		description:
			"说的是这个人，节名是人员要求。按期的记录（绩效、高潜）在卡里再列一节：几期、每期要怎样。",
		condition: {
			from: "person",
			id: "sample-perf",
			params: { band: "A", times: 2 },
			where:
				"(select count(*) from rating r where r.person_id = p.person_id and r.stream = 'perf' and r.period_end >= current_date - interval '3 years' and r.value_rank >= (select s.rank from scale s where s.stream = 'perf' and s.value = :band)) >= :times",
			label: "近三年绩效 A 及以上至少两次",
			mode: "must",
		},
		explained: {
			work: null,
			months: null,
			options: [
				{
					lead: null,
					rows: [
						{
							head: "至少 2 期绩效这样",
							kind: "nested",
							options: [
								{
									lead: null,
									rows: [
										{
											field: "期末",
											kind: "fact",
											value: [{ word: "不早于" }, { word: "3 年前" }],
										},
										{
											field: "档",
											kind: "fact",
											value: [{ tag: "A" }, { word: "及以上" }],
										},
									],
								},
							],
						},
					],
				},
			],
		},
	},
	{
		title: "排除",
		description:
			"排除的条件先说一句「有下面这样一段经历的人不要」；关键词条件没写判断标准，工作内容写简历里写到什么。",
		condition: {
			from: "experience",
			id: "sample-sales",
			where: "true",
			label: "做过销售",
			mode: "exclude",
			seek: { patterns: ["销售", "BD"] },
		},
		explained: {
			months: null,
			options: [],
			work: { written: [{ tag: "销售" }, { word: "/" }, { tag: "BD" }] },
		},
	},
];
