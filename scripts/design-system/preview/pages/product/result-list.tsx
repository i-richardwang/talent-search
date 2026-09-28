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
import {
	ResultList,
	SKELETON_DELAY,
} from "#/routes/s/$turnId/-components/result-list";
import { ELAPSED_SHOW_AFTER_MS } from "#/routes/s/$turnId/-lib/elapsed";
import type { ListWait } from "#/routes/s/$turnId/-lib/nav-phase";
import { usePicks } from "#/routes/s/$turnId/-lib/picks";
import type { SearchOutcome } from "#/search/result";
import type { SearchSpec } from "#/search/spec";
import type { InterpretFault, SearchMode } from "#/server/turn";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid } from "../../kit/stage";
import { Routed } from "../../routed";
import { EMPTY_CASES, KEYWORD_SPEC, SPEC } from "../../samples/conditions";
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
	wait?: ListWait | null;
	canMore?: boolean;
	fault?: InterpretFault | null;
};

/** 选择状态住在这一层：换一份名单（`key` 变）就是换了一次搜索，选中的人清空。 */
function List({
	outcome = OUTCOME,
	spec = SPEC,
	mode = "conversation",
	empId,
	wait = null,
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
				mode={mode}
				onAll={() => picks.pickAll(false)}
				onChange={noop}
				onEditQuery={noop}
				onMore={grow}
				onReviseQuery={noop}
				outcome={outcome}
				picks={picks}
				spec={spec}
				turnId={LATEST_TURN_ID}
				wait={wait}
			/>
		</Routed>
	);
}

type State =
	| "list"
	| "people"
	| "refreshing"
	| "searching"
	| "empty"
	| "failed";

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
	refreshing: { wait: { list: "dim", phase: "searching" } },
	searching: { wait: { list: "skeleton", phase: "searching" } },
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
							{ label: "改筛选", value: "refreshing" },
							{ label: "换问题", value: "searching" },
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

const EMPTIES = Object.values(EMPTY_CASES);

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

/** 名单：一次搜索找到的人，每人固定两行、行尾写几条里命中几条，以及选择、翻页和空态。 */
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
					"整行可点，覆盖层是真链接，支持中键、右键、键盘；选择框和行尾的命中标签压在覆盖层上，不进链接。",
					"选择框一直在；按住 Shift 点选择框连选，Esc 清空已选。批量操作用选择非空时才出现的 Toolbar。",
					`改筛选时旧名单留在原地调到六成；换问题时旧名单撤下，${SKELETON_DELAY / 1000} 秒后换成同形的占位行，表头说在做什么，等过 ${ELAPSED_SHOW_AFTER_MS / 1000} 秒写出秒数。`,
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
