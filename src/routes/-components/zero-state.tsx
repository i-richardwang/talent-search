import { useRef } from "react";
import { KeywordBar } from "#/components/keyword-bar";
import { QueryBar, type QueryBarHandle } from "#/components/query-bar";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import type { QueryInput } from "#/search/spec";
import type { SearchMode } from "#/server/turn";

/**
 * 整句的例子。四条，每条只教一件 placeholder 给不了的事，谁也不是谁的变体：
 *
 * 1. 一句话里放多个条件，口语句式会被剥干净（「做过…的人」不必自己删）
 * 2. 并列的两样都要——条件之间是 AND
 * 3. 「最好」是**加分**不是必须——chip 那三档强度的入口只在句子里
 * 4. 「或者」是**一条**条件的两个取值——取值之间是 OR
 *
 * 第 3、4 条挨着第 2 条排，因为 AND 和 OR 的差别只有并排看才看得出来。
 *
 * 手写的句子必须在库里搜得到人，否则第一次点它得到的是一份空名单——那是这个
 * 工具能给的最差的第一印象，而原因不在用户身上。所以每加一条都要走完整条路
 * 跑一遍（句子 → 理解 → 检索），不能只在脑子里读着通顺。库里表达不了的
 * 条件（地点、年龄）不能进这里：它们只换来一句「搜不了」，而例子是承诺，不是试探。
 *
 * 四条是上限。再多就从「样板」变成「目录」，人会开始挑而不是改——而这几句
 * 几乎肯定不是要找的那个人。
 */
const EXAMPLES = [
	"做过线下渠道运营、带过团队的人",
	"算法和后端都做过的",
	"做过增长，最好带过团队",
	"做过风控或者反欺诈的",
];

/**
 * 零态：标题、切换、输入面居中排成一列。
 *
 * 一进来先看见的是标题和能敲字的地方：这一屏是整个应用的起点，起点上没有什么
 * 需要先解释一遍。
 *
 * 标题是一个**问句**，不是应用名。应用名在顶栏上已经有一处，同一串字再摆一遍
 * 答不了「这一屏在做什么」。问句能：它把这块面要收什么说清楚，人照着答就行。
 *
 * 标题是字阶里的 20px 粗体。汉字系统字没有拉丁 display 字那种放大之后还成立的
 * 字形，撑成一行大字会读成横幅标语；这一屏的重量由下面的输入面承担，不由字号承担。
 */
export function ZeroState({
	mode,
	nav,
	onQuery,
	error,
}: {
	/** 这一屏开的是哪种搜索。没配查询理解时路由只给关键词（`routes/index.tsx`）。 */
	mode: SearchMode;
	/** 两种搜索的切换，摆在标题和输入面之间。只有一种搜索时路由不给。 */
	nav?: React.ReactNode;
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	error: string | null;
}) {
	const errorAlert = error && <Alert title={error} type="error" />;

	return (
		/*
		 * 从顶上排下来，不上下居中：两种搜索的输入面高矮不同，居中的话一切换
		 * 标题和切换都跟着上下跳。顶上一段固定的空，标题、切换、输入面的起点
		 * 在两屏里一分不动，变的只有切换下面那块。
		 */
		<div className="flex flex-col items-center gap-4 px-4 pt-16 md:pt-24">
			<h1 className="font-semibold text-fg text-xl">想找什么样的人？</h1>
			{/* 切换紧贴在它换的那块面上面。 */}
			{nav}

			{/* 输入面和名单同宽（版心）：搜索之后名单就落在同样这条列上，
			    左右边缘一分不动。

			    `gap-8`：输入面和例子是两件事，例子是**看完输入面之后**才需要的东西。
			    贴到 12px 以内它们会读成同一块面的上下两半。 */}
			<div className="flex w-full max-w-page flex-col gap-8">
				{mode === "conversation" ? (
					<ConversationStart errorAlert={errorAlert} onQuery={onQuery} />
				) : (
					<KeywordStart errorAlert={errorAlert} onQuery={onQuery} />
				)}
			</div>
		</div>
	);
}

/** 对话：说一句话。 */
function ConversationStart({
	onQuery,
	errorAlert,
}: {
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	errorAlert: React.ReactNode;
}) {
	const bar = useRef<QueryBarHandle>(null);
	return (
		<>
			{/* 报错紧贴着输入面，因为它说的就是这块面刚才发生了什么。 */}
			<div className="flex w-full flex-col gap-2">
				{/* 标题问要什么样的人；这里说框里装什么，并给一句能照着写的样子。 */}
				<QueryBar
					autoFocus
					onQuery={onQuery}
					placeholder="描述你要找的人，例如：做过推荐算法、带过团队"
					ref={bar}
				/>
				{/* 提交失败时界面其余部分一切正常，不说的话人只会以为自己没点上。
				    它是页面级的事件，所以是一块 `Alert`——和工作台上同一个
				    `useCommit().error` 长一个样，两屏不为同一件事各画一种。 */}
				{errorAlert}
			</div>

			{/*
			 * 例子是竖着的一列，每行占满输入面的宽度，左边缘对齐输入面里的那行字。
			 * 它们是**整句**且长短天差地别，竖排之后一条视线从上往下就扫完了，
			 * 扫的是句式本身——这一屏要教的就是「可以这样说话」。
			 */}
			<div className="flex w-full flex-col gap-0.5 text-left">
				<p className="px-3.5 pb-1 text-fg-tertiary text-xs">示例</p>
				{EXAMPLES.map((example) => (
					/*
					 * 点一条例子是**填进输入框**，不是直接搜。这几条是句式的样板，
					 * 要找的人几乎不会正好是其中哪一句——填进去，人才能把
					 * 「线下渠道运营」换成自己那个词再回车。上面那行小字先把这件事
					 * 说明白了。
					 */
					<Button
						block
						className="justify-start font-normal"
						key={example}
						onClick={() => bar.current?.fill(example)}
						type="text"
					>
						<span className="truncate">{example}</span>
					</Button>
				))}
			</div>
		</>
	);
}

/** 关键词：一个框一维，不经过模型。 */
function KeywordStart({
	onQuery,
	errorAlert,
}: {
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	errorAlert: React.ReactNode;
}) {
	return (
		<div className="flex w-full flex-col gap-2 text-left">
			<KeywordBar
				autoFocus
				onSearch={(conditions) =>
					onQuery({ kind: "spec", spec: { conditions } })
				}
			/>
			{errorAlert}
		</div>
	);
}
