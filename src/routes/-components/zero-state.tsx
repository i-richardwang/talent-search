import { AlertCircleIcon } from "lucide-react";
import { useRef } from "react";
import { QueryBar, type QueryBarHandle } from "#/components/query-bar";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import type { QueryInput } from "#/search/spec";

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
 * 条件（地点、年龄）不能进这里：它们会安静地消失，而例子是承诺，不是试探。
 *
 * 四条是上限。再多就从「样板」变成「目录」，人会开始挑而不是改——而这几句
 * 几乎肯定不是他要找的那个人。
 */
const EXAMPLES = [
	"做过线下渠道运营、带过团队的人",
	"算法和后端都做过的",
	"做过增长，最好带过团队",
	"做过风控或者反欺诈的",
];

/**
 * 零态。整块是 coss 的 `Empty`：标题一段、内容一段，间距和字阶都已经和这套
 * 系统对齐，所以这一屏不用自己摆居中容器，也不用自己配字号。
 *
 * 一进来先看见的是标题和能敲字的地方：这一屏是整个应用的起点，起点上没有什么
 * 需要先解释一遍。
 *
 * 标题是一个**问句**，不是应用名。应用名在顶栏上已经有一处，同一串字再摆一遍
 * 答不了「这一屏在做什么」。问句能：它把这块面要收什么说清楚，人照着答就行。
 *
 * 标题走 `EmptyTitle` 的原生档（20px）。汉字系统字没有拉丁 display 字那种放大
 * 之后还成立的字形，撑成一行大字会读成横幅标语；这一屏的重量由中间那块多行的
 * 输入面去扛，不由字号扛。
 */
export function ZeroState({
	onQuery,
	error,
}: {
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	error: string | null;
}) {
	const bar = useRef<QueryBarHandle>(null);

	return (
		/*
		 * 底下的内边距比顶上多一档（两个断点上都恰好多 48px），于是整组上移 24px。
		 * 顶栏在上面占掉一条，下方是空的，几何中心因此落在视觉中心**偏下**；抬这一档
		 * 之后输入面才停在眼睛真正会去找它的高度。差值走 `Empty` 自己的 `py` 档，
		 * 不另起一套算式。
		 */
		<Empty className="pb-24 md:pb-32">
			<EmptyHeader>
				{/* `EmptyTitle` 是个 `div`（coss 的文件一个字都不改），这一页的 h1
				    因此靠 ARIA 给，而不是在里面再套一个自己配一遍字号的 `<h1>`。 */}
				<EmptyTitle aria-level={1} role="heading">
					想找什么样的人？
				</EmptyTitle>
			</EmptyHeader>

			{/* `EmptyContent` 原生是 `max-w-sm`（给按钮组用的宽度）。这里装的是
			    输入面和它的例子，所以放宽到版心——回车之后名单就落在同样这条列上，
			    左右边缘一分不动。改的是布局宽度，不是组件内部的比例。

			    宽度写成 `max-w-(--container-page)` 而不是 `max-w-page`：这一处要盖掉
			    组件自带的 `max-w-sm`，而盖不盖得掉由 `cn` 里的 tailwind-merge 决定，
			    它只认得变量形式；类名形式它当成两个无关的类，两条规则一起进 CSS，
			    最后按样式表里的先后决胜负——`.max-w-sm` 排在后面，赢的是 24rem，
			    而且构建、类型、测试全绿。别处的 `max-w-page` 都写在没人跟它抢的
			    普通 div 上，那里怎么写都对。

			    `gap-8`：输入面和例子是两件事，例子是**看完输入面之后**才需要的东西。
			    贴到 12px 以内它们会读成同一块面的上下两半。 */}
			<EmptyContent className="max-w-(--container-page) gap-8">
				{/* 报错紧贴着输入面，因为它说的就是这块面刚才发生了什么。 */}
				<div className="flex w-full flex-col gap-2">
					<QueryBar onQuery={onQuery} ref={bar} />
					{/* 提交失败时界面其余部分一切正常，不说的话人只会以为自己没点上。
					    它是页面级的事件，所以是一块 `Alert`——和工作台上同一个
					    `useCommit().error` 长一个样，两屏不为同一件事各画一种。 */}
					{error && (
						<Alert variant="error">
							<AlertCircleIcon />
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}
				</div>

				{/*
				 * 例子是竖着的一列，每行占满输入面的宽度，左边缘对齐输入面里的那行字。
				 * 它们是**整句**且长短天差地别，竖排之后一条视线从上往下就扫完了，
				 * 扫的是句式本身——这一屏要教的就是「可以这样说话」。
				 */}
				<div className="flex w-full flex-col gap-0.5 text-left">
					<p className="px-3 pb-1 text-muted-foreground text-xs">试试这样问</p>
					{EXAMPLES.map((example) => (
						/*
						 * 点一条例子是**填进输入框**，不是直接搜。这几条是句式的样板，
						 * 要找的人几乎不会正好是其中哪一句——填进去，人才能把
						 * 「线下渠道运营」换成自己那个词再回车。上面那行小字先把这件事
						 * 说明白了。
						 *
						 * 尺码是 `default` 而不是 `sm`：`default` 的水平内边距
						 * （`--spacing(3)` 减去 1px 边框，加回 1px 边框）和输入面里
						 * 那个 textarea 一模一样，于是例句的左边缘和 placeholder 的
						 * 左边缘落在同一条线上。`sm` 差 2px，看得出来。
						 */
						<Button
							className="w-full justify-start"
							key={example}
							onClick={() => bar.current?.fill(example)}
							variant="ghost"
						>
							<span className="truncate">{example}</span>
						</Button>
					))}
				</div>
			</EmptyContent>
		</Empty>
	);
}
