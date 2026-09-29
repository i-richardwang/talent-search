import {
	GitMergeIcon,
	ListChecksIcon,
	type LucideIcon,
	SplitIcon,
	ThumbsUpIcon,
} from "lucide-react";
import { type ReactNode, useRef } from "react";
import { KeywordBar } from "#/components/keyword-bar";
import { QueryBar, type QueryBarHandle } from "#/components/query-bar";
import { Alert } from "#/components/ui/alert";
import { GroupBlock, GroupBlockItem } from "#/components/ui/group-block";
import type { QueryInput } from "#/search/spec";
import type { SearchMode } from "#/server/turn";

/**
 * 整句的例子，最多四条。每条只教一件 placeholder 给不了的事，第二行说的就是它教的那件事：
 *
 * 1. 一句话里放多个条件，口语句式会被自动去掉（「做过…的人」不必自己删）
 * 2. 并列的两样都要——条件之间是 AND
 * 3. 「最好」是**加分**不是必须
 * 4. 「或者」是**一条**条件的两个取值——取值之间是 OR
 *
 * 句子必须在人才库里搜得到人，否则第一次点它得到的是一份空名单。每加一条都要走完
 * 句子 → 理解 → 检索整条路。人才库里表达不了的条件（地点、年龄）不能进这里。
 */
const EXAMPLES: { text: string; teaches: string; icon: LucideIcon }[] = [
	{
		icon: ListChecksIcon,
		teaches: "一句话里写几样要求，找的是样样都满足的人",
		text: "做过线下渠道运营、带过团队的人",
	},
	{
		icon: GitMergeIcon,
		teaches: "「都做过」：两段经历都要有",
		text: "算法和后端都做过的",
	},
	{
		icon: ThumbsUpIcon,
		teaches: "「最好」是加分项：没带过团队的也在名单上，排在后面",
		text: "做过增长，最好带过团队",
	},
	{
		icon: SplitIcon,
		teaches: "「或者」：做过其中一样就行",
		text: "做过风控或者反欺诈的",
	},
];

/** 首页正文的两块：输入面，和一条记录都还没有时放在它下面的起步例子。 */
type ZeroStateParts = { input: ReactNode; starters: ReactNode };

/**
 * 首页的输入面，和对话时几条起步的例子。点例子是**填进输入框**，不是直接搜：要找的人
 * 几乎不会正好是其中哪一句。两块怎么排由 `layout` 定，不给时上下排开。
 */
export function ZeroState({
	mode,
	modeSelect,
	onQuery,
	error,
	layout = (parts) => (
		<>
			{parts.input}
			{parts.starters}
		</>
	),
}: {
	mode: SearchMode;
	/** 两种搜索的切换，放进托盘的动作栏；只有一种搜索时不给。 */
	modeSelect?: ReactNode;
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	error: string | null;
	layout?: (parts: ZeroStateParts) => ReactNode;
}) {
	const bar = useRef<QueryBarHandle>(null);
	// 提交失败时界面其余部分一切正常，不说的话人只会以为自己没点上
	const errorAlert = error && <Alert title={error} type="error" />;

	if (mode === "keyword")
		return layout({
			input: (
				<div className="flex flex-col gap-2">
					<KeywordBar
						autoFocus
						left={modeSelect}
						onSearch={(conditions) =>
							onQuery({ kind: "spec", spec: { conditions } })
						}
						size="large"
					/>
					{errorAlert}
				</div>
			),
			starters: null,
		});

	return layout({
		input: (
			<div className="flex flex-col gap-2">
				<QueryBar
					autoFocus
					left={modeSelect}
					onQuery={onQuery}
					placeholder="描述你要找的人，例如：做过推荐算法、带过团队"
					ref={bar}
					size="large"
				/>
				{errorAlert}
			</div>
		),
		starters: (
			// 比输入托盘和列表行各往里收一点：两边都是有内边距的面，贴着列边排会显得悬在外面
			<GroupBlock
				className="px-3 py-2"
				description="点一条填进输入框，改成你要找的人再发送"
				title="可以这样描述"
			>
				{EXAMPLES.map((example) => (
					<GroupBlockItem
						description={example.teaches}
						icon={example.icon}
						key={example.text}
						onClick={() => bar.current?.fill(example.text)}
						render={<button type="button" />}
						title={example.text}
						variant="prose"
					/>
				))}
			</GroupBlock>
		),
	});
}
