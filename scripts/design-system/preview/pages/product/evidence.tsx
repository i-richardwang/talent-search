import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import type { Route } from "#/db/schema";
import { ClaimEvidence } from "#/routes/s/$turnId/-components/claim-evidence";
import {
	Dot,
	EvidenceLine,
	evidenceText,
	MissedClaims,
} from "#/routes/s/$turnId/-components/evidence";
import { claimLines } from "#/routes/s/$turnId/-lib/claim-lines";
import { routeLabel } from "#/search/evidence";
import type { ClaimBasis, Hit } from "#/search/result";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { CLAIMS } from "../../samples/conditions";
import { experience, hitOn, RESULTS } from "../../samples/people";

/** 每类来源在试用里配的命中：命中的词、抽取出的说法和参与方式。 */
const ROUTE_HIT: Record<
	Route,
	Pick<
		Hit,
		| "value"
		| "phrase"
		| "involvement"
		| "company"
		| "department"
		| "title"
		| "seq"
	>
> = {
	role: {
		value: "推荐系统",
		phrase: null,
		involvement: null,
		company: "",
		department: "推荐算法部",
		title: "高级算法工程师",
		seq: "技术 · 算法 · 推荐",
	},
	title: {
		value: "推荐系统",
		phrase: null,
		involvement: null,
		company: "某乙网络",
		department: "",
		title: "推荐系统工程师",
		seq: "技术 · 算法",
	},
	skill: {
		value: "推荐系统",
		phrase: "推荐系统",
		involvement: null,
		company: "某甲科技",
		department: "",
		title: "算法工程师",
		seq: "技术 · 算法",
	},
	did: {
		value: "推荐系统",
		phrase: "实时推荐系统",
		involvement: "从零搭建",
		company: "某甲科技",
		department: "",
		title: "算法工程师",
		seq: "技术 · 算法",
	},
	description: {
		value: "推荐系统",
		phrase: null,
		involvement: null,
		company: "某戊电商",
		department: "",
		title: "数据分析师",
		seq: "技术 · 数据分析",
	},
};

const ROUTES = Object.keys(ROUTE_HIT) as Route[];

/** 按来源拼一条命中和它的累计依据；`other` 时命中的是同组的另一个写法。 */
function sample(
	route: Route,
	{
		external = false,
		ongoing = true,
		other = false,
		months = 52,
	}: {
		external?: boolean;
		ongoing?: boolean;
		other?: boolean;
		months?: number;
	} = {},
): { hit: Hit; basis: ClaimBasis } {
	const base = ROUTE_HIT[route];
	const value = other ? "推荐算法" : base.value;
	const endDate = ongoing ? null : "2023-06-30";
	return {
		hit: hitOn(experience(102), {
			...base,
			value,
			route,
			startDate: "2019-07-01",
			endDate,
		}),
		basis: { route, value, relevance: 0.9, months, endDate, external },
	};
}

function Playground() {
	const [route, setRoute] = useState<Route>("role");
	const [boost, setBoost] = useState(false);
	const [external, setExternal] = useState(false);
	const [ongoing, setOngoing] = useState(true);
	const [other, setOther] = useState(false);
	const { hit, basis } = sample(route, { external, ongoing, other });
	const name = "推荐系统";
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="证据来源">
					<Segmented<Route>
						onChange={setRoute}
						options={ROUTES.map((value) => ({
							label: routeLabel(value) || "做过的事",
							value,
						}))}
						value={route}
					/>
				</Control>
				<Control>
					<Checkbox checked={boost} onChange={setBoost}>
						加分条件
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={external} onChange={setExternal}>
						入职前
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={ongoing} onChange={setOngoing}>
						仍在这段经历里
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={other} onChange={setOther}>
						命中的是另一个写法
					</Checkbox>
				</Control>
			</Controls>
			<Stage footer={<span>导出为：{evidenceText(name, hit, basis)}</span>}>
				<div className="w-full max-w-xl">
					<EvidenceLine basis={basis} boost={boost} hit={hit} name={name} />
				</div>
			</Stage>
		</div>
	);
}

function Routes() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>来源</TableHead>
						<TableHead>证据行</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{ROUTES.map((route) => {
						const { hit, basis } = sample(route, {
							external: route !== "role",
						});
						return (
							<TableRow key={route}>
								<TableCell className="font-mono text-xs">{route}</TableCell>
								<TableCell className="min-w-100">
									<EvidenceLine
										basis={basis}
										boost={false}
										hit={hit}
										name="推荐系统"
									/>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</Block>
	);
}

function Parts() {
	return (
		<ExampleGrid>
			<Example
				description="命中的点是深一档的实心点，没命中的点是浅色；点不分来源，来源写在证据行上。"
				title="点"
			>
				<div className="flex items-center gap-3 text-xs">
					<span className="flex items-center gap-1.5">
						<Dot hit />
						命中
					</span>
					<span className="flex items-center gap-1.5">
						<Dot hit={false} />
						未命中
					</span>
				</div>
			</Example>
			<Example
				description="没命中的主张合成一行，点是浅色；全部命中时这一行不画。"
				title="未命中"
			>
				<div className="w-full">
					<MissedClaims names={["团队管理", "技术分享"]} />
				</div>
			</Example>
		</ExampleGrid>
	);
}

function Usage() {
	const [first, , third, , , last] = RESULTS;
	const aligned = [4, 18, 52, 131].map((months, i) => ({
		months,
		...sample(i % 2 === 0 ? "role" : "skill", { months }),
	}));
	return (
		<ExampleGrid>
			{first && (
				<Example
					description="一个人一组证据行，名单行尾的气泡和人的详情里都是这一组：必须的在前，加分的名字前带 +。"
					title="一个人的匹配依据"
				>
					<ClaimEvidence lines={claimLines(first, CLAIMS)} />
				</Example>
			)}
			{last && (
				<Example
					description="证据都来自简历的人和其他人一样按对得上多少、做了多久、离现在多近排，来源写在每一行上；没命中的加分条件合成一行。"
					title="证据来自简历"
				>
					<ClaimEvidence lines={claimLines(last, CLAIMS)} />
				</Example>
			)}
			{third && (
				<Example
					description="命中的是同组的另一个写法时，前面写出「匹配依据」，HR 看得到凭什么算命中。"
					title="换了写法的命中"
				>
					<ClaimEvidence lines={claimLines(third, CLAIMS)} />
				</Example>
			)}
			<Example
				description="右端时长折成年、宽度固定，同一条件的多行上下对齐，能直接比长短。"
				title="时长对齐"
			>
				<div className="flex w-full flex-col gap-1.5">
					{aligned.map(({ months, hit, basis }) => (
						<EvidenceLine
							basis={basis}
							boost={false}
							hit={hit}
							key={months}
							name="推荐系统"
						/>
					))}
				</div>
			</Example>
		</ExampleGrid>
	);
}

/** 证据行：一条主张的一行证据，以及它的点阵、图例和未命中行。 */
export function EvidencePage() {
	return (
		<DocPage
			facts={[`${ROUTES.length} 类来源`, "命中与未命中两种点", "加分标记"]}
			rules={{
				notes: [
					"点只说命中没有：Dot 和 HIT_FILL 不分来源，职业轨迹条和时间线读同一套。来源用字写在证据行上：任职记录、岗位、技能、做过的事、简历原文。",
					"来源不决定名次也不决定去留：名次只看对得上多少、做了多久、离现在多近。",
					"右端显示的时长和排序用的时长是同一份，不另算。",
					"证据行出现在名单行尾的依据气泡和人的详情「匹配依据」里，12px：条件词和时长是次要色（做完的时长退到三级灰），命中的字段与字段名三级灰，上下文四级灰。",
					"必须 / 加分靠符号区分，必须不带标记；不显示分数和名次。",
				],
				usage: `<EvidenceLine\n  basis={basis}\n  boost={claim.mode === "boost"}\n  hit={hit}\n  name={claimName(claim)}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用证据行" },
				{ children: <Routes />, id: "appearance", title: "来源" },
				{ children: <Parts />, id: "parts", title: "点与未命中" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
