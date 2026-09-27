import { CornerDownRightIcon } from "lucide-react";
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
 * 手写的句子必须在库里搜得到人，否则第一次点它得到的是一份空名单。每加一条都要
 * 走完整条路跑一遍（句子 → 理解 → 检索）。库里表达不了的条件（地点、年龄）不能进这里。
 * 四条是上限：再多就从「样板」变成「目录」。
 */
const EXAMPLES = [
	"做过线下渠道运营、带过团队的人",
	"算法和后端都做过的",
	"做过增长，最好带过团队",
	"做过风控或者反欺诈的",
];

/**
 * 首页的正文：居中的一列，从上到下是问句、输入托盘，对话时下面再跟几条例子。
 *
 * 标题是一个**问句**，不是应用名：应用名在导航栏顶上已经有一处，问句说得清这块面
 * 要收什么。它用字阶里的 20px 粗体，这一屏的重量由那块大号输入托盘承担。
 *
 * 两种搜索是同一块大号托盘，搜索方式的切换（`modeSelect`）在托盘动作栏的左端：
 * 换过去只换托盘里面的内容，问句、托盘的位置和高度都不动。从顶上排下来，不上下居中。
 */
export function ZeroState({
	mode,
	modeSelect,
	onQuery,
	error,
}: {
	/** 这一屏开的是哪种搜索。没配查询理解时路由只给关键词（`routes/index.tsx`）。 */
	mode: SearchMode;
	/** 两种搜索的切换，放进托盘的动作栏。只有一种搜索时路由不给。 */
	modeSelect?: React.ReactNode;
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	error: string | null;
}) {
	// 提交失败时界面其余部分一切正常，不说的话人只会以为自己没点上
	const errorAlert = error && <Alert title={error} type="error" />;

	return (
		<div className="mx-auto flex w-full max-w-page flex-col gap-6 px-6 pt-12 pb-16 md:pt-24">
			<h1 className="font-semibold text-fg text-xl">想找什么样的人？</h1>
			{mode === "conversation" ? (
				<ConversationStart
					errorAlert={errorAlert}
					modeSelect={modeSelect}
					onQuery={onQuery}
				/>
			) : (
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
			)}
		</div>
	);
}

/** 对话：说一句话。 */
function ConversationStart({
	onQuery,
	errorAlert,
	modeSelect,
}: {
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	errorAlert: React.ReactNode;
	modeSelect: React.ReactNode;
}) {
	const bar = useRef<QueryBarHandle>(null);
	return (
		<>
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

			{/*
			 * 例子竖着排成一列：它们是整句且长短天差地别，竖排之后一条视线从上往下
			 * 就扫完了，扫的是句式本身。点一条是**填进输入框**，不是直接搜：
			 * 要找的人几乎不会正好是其中哪一句，填进去才能把词换成自己的再回车。
			 */}
			<section aria-labelledby="examples" className="flex flex-col gap-1">
				<h2
					className="px-1 font-semibold text-fg-secondary text-xs"
					id="examples"
				>
					可以这样描述
				</h2>
				<div className="-mx-1 flex flex-col">
					{EXAMPLES.map((example) => (
						<Button
							block
							className="justify-start font-normal"
							icon={CornerDownRightIcon}
							key={example}
							onClick={() => bar.current?.fill(example)}
							type="text"
						>
							<span className="truncate">{example}</span>
						</Button>
					))}
				</div>
			</section>
		</>
	);
}
