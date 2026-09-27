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
import { ResultList } from "#/routes/s/$turnId/-components/result-list";
import { usePicks } from "#/routes/s/$turnId/-lib/picks";
import type { EmptyReason } from "#/search/empty";
import type { SearchOutcome } from "#/search/result";
import type { SearchSpec } from "#/search/spec";
import type { InterpretFault, SearchMode } from "#/server/turn";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid } from "../../kit/stage";
import { Routed } from "../../routed";
import {
	CLAIMS,
	EXCLUDE_INTERN,
	KEYWORD_SPEC,
	SPEC,
	WIDE_CONDITION,
} from "../../samples/conditions";
import {
	EMPTY_OUTCOME,
	firstOf,
	OUTCOME,
	OVER_LIMIT,
	PEOPLE_OUTCOME,
	TWO_PAGES,
} from "../../samples/people";
import { LATEST_TURN_ID } from "../../samples/thread";

/** 名单这一格要的几样；没给的按一份六个人的名单补上。 */
type ListProps = {
	outcome?: SearchOutcome;
	spec?: SearchSpec;
	mode?: SearchMode;
	empId?: string;
	loading?: boolean;
	canMore?: boolean;
	fault?: InterpretFault | null;
};

/** 选择状态住在这一层：换一份名单（`key` 变）就是换了一次搜索，选中的人清空。 */
function List({
	outcome = OUTCOME,
	spec = SPEC,
	mode = "conversation",
	empId,
	loading = false,
	canMore = false,
	fault = null,
}: ListProps) {
	const picks = usePicks(LATEST_TURN_ID, outcome);
	const [growing, setGrowing] = useState(false);
	const grow = () => {
		setGrowing(true);
		window.setTimeout(() => setGrowing(false), 1200);
	};
	const noop = () => {};
	return (
		<Routed url={`/s/${LATEST_TURN_ID}`}>
			<ResultList
				canMore={canMore}
				empId={empId}
				failure={fault ? { fault, onRetry: noop } : null}
				growing={growing}
				loading={loading}
				mode={mode}
				onAll={() => picks.pickAll(false)}
				onChange={noop}
				onEditQuery={noop}
				onMore={grow}
				onReviseQuery={noop}
				outcome={outcome}
				phase="searching"
				picks={picks}
				spec={spec}
				turnId={LATEST_TURN_ID}
			/>
		</Routed>
	);
}

type State = "list" | "people" | "searching" | "empty" | "failed";

const STATE_PROPS: Record<State, ListProps> = {
	empty: { outcome: EMPTY_OUTCOME },
	failed: { fault: "unreachable" },
	list: {},
	people: {
		outcome: PEOPLE_OUTCOME,
		spec: {
			conditions: [
				{ about: "person", mode: "must", field: "education", atLeast: "硕士" },
			],
		},
	},
	searching: { loading: true },
};

function Playground() {
	const [state, setState] = useState<State>("list");
	const [many, setMany] = useState(false);
	const [open, setOpen] = useState(false);
	const base = STATE_PROPS[state];
	const outcome = base.outcome ?? OUTCOME;
	const props: ListProps = {
		...base,
		canMore: many,
		empId: open ? "T0101" : undefined,
		outcome: many
			? firstOf(outcome, outcome.results.length, TWO_PAGES)
			: outcome,
	};
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="状态">
					<Segmented<State>
						onChange={setState}
						options={[
							{ label: "按匹配度", value: "list" },
							{ label: "按人排", value: "people" },
							{ label: "搜索中", value: "searching" },
							{ label: "没有结果", value: "empty" },
							{ label: "理解失败", value: "failed" },
						]}
						value={state}
					/>
				</Control>
				<Control>
					<Checkbox checked={many} onChange={setMany}>
						超过一页
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={open} onChange={setOpen}>
						打开第一个人的详情
					</Checkbox>
				</Control>
			</Controls>
			<Block padding={16} variant="filled">
				<div className="mx-auto w-full max-w-(--container-page)">
					<List key={`${state}-${many}`} {...props} />
				</div>
			</Block>
		</div>
	);
}

/** 每种空态的成因，和一份让它出现的查询。 */
const EMPTIES: [reason: EmptyReason, spec: SearchSpec][] = [
	[{ kind: "unmet" }, SPEC],
	[{ kind: "noHits" }, SPEC],
	[{ kind: "filtered" }, SPEC],
	[
		{ kind: "gatesUnmet" },
		{
			conditions: [
				{ about: "person", mode: "must", field: "school", values: ["学校 E"] },
			],
		},
	],
	[{ kind: "overflowEvidence", claims: CLAIMS }, SPEC],
	[{ kind: "overflowPopulation" }, SPEC],
	[{ kind: "allDisabled" }, { conditions: [WIDE_CONDITION] }],
	[{ kind: "excludeOnly" }, { conditions: [EXCLUDE_INTERN] }],
	[{ kind: "noConditions" }, { conditions: [] }],
];

function Empties() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>成因</TableHead>
						<TableHead>名单那一列</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{EMPTIES.map(([reason, spec]) => (
						<TableRow key={reason.kind}>
							<TableCell className="font-mono text-xs">{reason.kind}</TableCell>
							<TableCell className="w-full">
								<List
									outcome={{ ...EMPTY_OUTCOME, empty: reason }}
									spec={spec}
								/>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="每一行左边是选择框，表头那一个全选；选了人，名单下沿浮出一条操作栏，能看已选的人、清空、导出。"
				title="挑人导出"
			>
				<div className="w-full">
					<List outcome={firstOf(OUTCOME, 3)} />
				</div>
			</Example>
			<Example
				description="只有人的条件（职级、学历之类）时没有证据行可画，名单按人排，抬头写「默认顺序」。"
				title="只有人的条件"
			>
				<div className="w-full">
					<List
						outcome={firstOf(PEOPLE_OUTCOME, 3)}
						spec={STATE_PROPS.people.spec}
					/>
				</div>
			</Example>
			<Example
				description="超出加载上限时不静默截断：说清显示了多少、共多少，出路是加条件缩小范围。"
				title="超出上限"
			>
				<div className="w-full">
					<List outcome={firstOf(OUTCOME, 2, OVER_LIMIT)} />
				</div>
			</Example>
			<Example
				description="关键词搜索的空态出路说法不同：回到名单上方的框里改词，而不是换一种说法。"
				title="关键词搜索没有结果"
			>
				<div className="w-full">
					<List mode="keyword" outcome={EMPTY_OUTCOME} spec={KEYWORD_SPEC} />
				</div>
			</Example>
		</ExampleGrid>
	);
}

/** 名单：一次搜索找到的人，每人一张卡片、每条主张一行证据，以及选择、翻页和空态。 */
export function ResultListPage() {
	return (
		<DocPage
			facts={[
				`${Object.keys(STATE_PROPS).length} 种状态`,
				`${EMPTIES.length} 种空态`,
				"选择与导出",
			]}
			rules={{
				notes: [
					"名单只从检索来，谁在上面、排第几由检索决定；名单位置表达顺序，分数和名次不上屏。",
					"整张卡片可点，覆盖层是姓名那个真链接，支持中键、右键、键盘；选择框放在卡片外。",
					"选中态用 Block 的 selected，不另加装饰；批量操作用选择非空时才出现的 Toolbar。",
					"列表不静默截断：说明已显示数、总数、排序和加载上限。",
					"空态成因由检索层判定，这里穷尽翻译成结论和出路；理解失败不是空名单。",
				],
				usage: `<ResultList\n  outcome={outcome}\n  picks={usePicks(turnId, outcome)}\n  spec={spec}\n  turnId={turnId}\n  …\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用名单" },
				{ children: <Empties />, id: "appearance", title: "空态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
