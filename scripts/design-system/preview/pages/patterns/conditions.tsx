import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import {
	FilterPopover,
	FilterRail,
} from "#/routes/s/$turnId/-components/filter-rail";
import { QueryChips } from "#/routes/s/$turnId/-components/query-chips";
import {
	activeCount,
	filterFields,
	textFilters,
} from "#/routes/s/$turnId/-lib/filters";
import type { View } from "#/routes/s/$turnId/-lib/view-params";
import {
	type Condition,
	type ExperienceCondition,
	MODES,
	PERSON_FIELDS,
	withOff,
} from "#/search/condition";
import { inSentence } from "#/search/condition-label";
import { DIM_KEYS, DIMENSIONS } from "#/search/dimensions";
import { KEYWORD_LABEL } from "#/search/keywords";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import {
	CONDITIONS,
	EXCLUDE_INTERN,
	WIDE_CONDITION,
} from "../../samples/conditions";
import { FACETS } from "../../samples/people";

/** 试用区一开始的搜索条件：名单那一次的三条，加一条排除和一条太宽被停用的。 */
const START: Condition[] = [...CONDITIONS, EXCLUDE_INTERN, WIDE_CONDITION];

/** 用户自己停用的一条：带过团队（加分）。 */
const TEAM_OFF = withOff(CONDITIONS[2] as Condition, "user");

/** 一条条件的每种样子。 */
const LOOKS: [name: string, condition: Condition, note: string][] = [
	[
		"must",
		{ about: "experience", mode: "must", what: ["推荐系统"] },
		"必须：默认强度，没有符号，填充底",
	],
	[
		"must · 多个取值",
		CONDITIONS[0] as Condition,
		"一项里有几个取值时标签后接「≈」，展开能逐个去掉",
	],
	["boost", CONDITIONS[2] as Condition, "加分：前面一个符号，满足的人排在前面"],
	["exclude", EXCLUDE_INTERN, "排除：划掉，有这类经历的人不上名单"],
	["off · user", TEAM_OFF, "自己停用：虚线边、眼睛图标，重新启用后强度不变"],
	[
		"off · wide",
		WIDE_CONDITION,
		"几乎所有人都满足，AI 整理时就停用了，标「太宽」",
	],
	[
		"person",
		{ about: "person", mode: "boost", field: "education", atLeast: "硕士" },
		"人的条件：学历、职级这类按档比，「及以上」比档高",
	],
];

/** 已启用的条件写成一句话；一条都没启用时照实说。 */
function sentenceOf(conditions: readonly Condition[]) {
	const on = conditions.filter((c) => !c.off);
	return on.length > 0 ? inSentence(on) : "没有启用的条件";
}

function Playground() {
	const [conditions, setConditions] = useState<Condition[]>(START);
	const [view, setView] = useState<View>({});
	const fields = filterFields(FACETS, view);
	const texts = textFilters(view);
	const change = (next: Partial<View>) =>
		setView((old) => ({ ...old, ...next }));
	const count = activeCount(fields, texts);
	return (
		<div className="flex flex-col gap-4">
			<Stage
				className="items-stretch"
				footer={
					<>
						<span>搜索条件：{sentenceOf(conditions)}</span>
						<Button
							onClick={() => setConditions(START)}
							size="small"
							type="link"
						>
							还原
						</Button>
					</>
				}
			>
				<div className="flex flex-wrap items-center gap-1.5">
					<QueryChips conditions={conditions} onChange={setConditions} />
				</div>
			</Stage>
			<Stage
				className="items-stretch p-0"
				footer={
					<span>
						{count > 0 ? `已筛选 ${count} 项` : "未筛选"}
						{" · "}筛选只换这次名单的看法，不改搜索条件
					</span>
				}
			>
				<div className="flex min-h-0">
					<FilterRail
						fields={fields}
						loading={false}
						onChange={change}
						textFilters={texts}
					/>
					<div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
						<div>
							<FilterPopover
								fields={fields}
								loading={false}
								onChange={change}
								textFilters={texts}
							/>
						</div>
						<p className="text-fg-secondary text-xs leading-5">
							宽屏上筛选是名单左边的一栏；窄屏上收进「筛选」按钮，点开是同一份列表。
							两处读写同一份筛选，勾一项，另一处跟着变。
						</p>
					</div>
				</div>
			</Stage>
		</div>
	);
}

function Looks() {
	const [rows, setRows] = useState(LOOKS.map(([, c]) => c));
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>强度与状态</TableHead>
						<TableHead>条件</TableHead>
						<TableHead>说明</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{LOOKS.map(([name, , note], i) => {
						const one = rows[i];
						return (
							<TableRow key={name}>
								<TableCell className="whitespace-nowrap font-mono text-xs">
									{name}
								</TableCell>
								<TableCell>
									{one ? (
										<QueryChips
											conditions={[one]}
											onChange={(next) =>
												setRows((old) =>
													old.map((c, j) =>
														j === i ? (next[0] ?? LOOKS[i]?.[1] ?? c) : c,
													),
												)
											}
										/>
									) : null}
								</TableCell>
								<TableCell className="text-fg-secondary text-xs">
									{note}
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</Block>
	);
}

/**
 * 除了筛选栏，也能写进搜索条件的几维：人的条件能落的维，加上经历主张里取值是
 * 词表档的两项（`search/condition.ts` 的条件形状）。
 */
const IN_CONDITIONS: readonly string[] = [
	...PERSON_FIELDS,
	...(["companyTag", "kind"] satisfies (keyof ExperienceCondition)[]),
];

/** 每一维在两种搜索里各放在哪：填词的维在关键词框，有限取值的维只在筛选栏。 */
const SPLIT: [dimension: string, keyword: string, conversation: string][] = [
	...Object.values(KEYWORD_LABEL).map((label): [string, string, string] => [
		label,
		"名单上方的关键词框",
		"搜索条件",
	]),
	["累计年限", "关键词框（每项经历分别累计）", "搜索条件里的「累计」"],
	...DIM_KEYS.map((key): [string, string, string] => [
		DIMENSIONS[key].label,
		"筛选栏",
		IN_CONDITIONS.includes(key)
			? "筛选栏；需求里说到时也写成搜索条件"
			: "筛选栏",
	]),
];

function Split() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>维</TableHead>
						<TableHead>关键词搜索</TableHead>
						<TableHead>AI 搜索</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{SPLIT.map(([dimension, keyword, conversation]) => (
						<TableRow key={dimension}>
							<TableCell className="whitespace-nowrap font-medium">
								{dimension}
							</TableCell>
							<TableCell>{keyword}</TableCell>
							<TableCell className="text-fg-secondary">
								{conversation}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	const [conditions, setConditions] = useState<Condition[]>(CONDITIONS);
	const [view, setView] = useState<View>({
		level: ["L7"],
		org: ["某甲科技"],
	});
	const fields = filterFields(FACETS, view);
	return (
		<ExampleGrid>
			<Example
				description="在条件上直接改强度、去掉一个取值、停用或删除，都是换一个问题：记成新的一次搜索，右栏线程里记一行改了什么。"
				title="直接改条件"
			>
				<div className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center gap-1.5">
						<QueryChips conditions={conditions} onChange={setConditions} />
					</div>
					<span className="text-fg-secondary text-xs">
						{sentenceOf(conditions)}
					</span>
				</div>
			</Example>
			<Example
				description="已选的筛选排在最前、带「清除」；公司、学校这类名称条件没有候选，只能看见和清掉。计数都是人。"
				title="已经筛过的名单"
			>
				<FilterPopover
					fields={fields}
					loading={false}
					onChange={(next) => setView((old) => ({ ...old, ...next }))}
					textFilters={textFilters(view)}
				/>
			</Example>
			<Example
				description="累计年限是一类经历加起来多久，经历时长是单段多久：两件事各有各的标签，不合并。"
				title="累计与单段"
			>
				<div className="flex flex-wrap items-center gap-1.5">
					<QueryChips
						conditions={[CONDITIONS[1] as Condition]}
						onChange={() => {}}
					/>
				</div>
			</Example>
			<Example
				description="关键词搜索没有条件可点：词就在名单上方的框里改，这里再摆一排就是同一样东西画两遍。"
				title="关键词搜索不画条件"
			>
				<span className="text-fg-secondary text-sm">
					标题写框里的词，改词回到框里。
				</span>
			</Example>
		</ExampleGrid>
	);
}

/** 搜索条件与筛选：条件决定找谁，筛选只换这次名单的看法。 */
export function ConditionsPage() {
	return (
		<DocPage
			facts={[`${MODES.length} 种强度`, "可停用", "筛选栏与筛选弹层"]}
			rules={{
				notes: [
					"必须 / 加分 / 排除靠符号区分，必须是默认状态；停用按条件本身记着，下次整理原样带回。",
					"条件之间是「且」、同一个人；一项里的几个取值是「或」且同权。",
					"改条件是换一个问题，记成新的一次搜索；筛选是同一次搜索换个看法，写进地址，浏览器后退可撤销。",
					"关键词搜索的查询面只放填词的维，有限取值的维只在筛选栏：同一维不在两处出现。",
					"累计年限（搜索条件）和经历时长（筛选）不是一件事，各有各的标签。",
					"筛选控件的计数单位是人；单选用 Radio，多选用 Checkbox，菜单里的开关用开关项。",
				],
				usage: `<QueryChips conditions={spec.conditions} onChange={revise} />\n<FilterRail\n  fields={filterFields(facets, view)}\n  loading={loading}\n  onChange={updateView}\n  textFilters={textFilters(view)}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用" },
				{ children: <Looks />, id: "appearance", title: "强度与停用" },
				{ children: <Split />, id: "split", title: "条件与筛选的分工" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
