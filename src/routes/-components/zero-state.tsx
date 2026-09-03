import { SearchIcon } from "lucide-react";
import { useRef } from "react";
import { QueryBar, type QueryBarHandle } from "#/components/query-bar";
import { Button } from "#/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#/components/ui/empty";
import type { QueryInput } from "#/search/spec";

/**
 * 整句的例子。这两条各带一样 placeholder 给不了的东西：一句话里放多个条件，
 * 以及口语句式会被剥干净（「做过…的人」不必自己删）。
 *
 * 手写的句子必须在库里搜得到人，否则第一次点它得到的是一份空名单——
 * 那是这个工具能给的最差的第一印象，而原因不在用户身上。
 */
const EXAMPLES = ["做过线下渠道运营、带过团队的人", "算法和后端都做过的"];

/**
 * 零态。整块是 coss 的 `Empty`：媒介、标题、内容三段，间距、字阶和那层 `before:`
 * 顶光边都已经和这套系统对齐，所以这一屏既不用自己摆居中容器，也不用自己配字号。
 *
 * 标题走 `EmptyTitle` 的原生档（20px）。汉字系统字没有拉丁 display 字那种放大
 * 之后还成立的字形，把「人才搜索」撑成一行大字会读成横幅标语；这一屏的重量由
 * 中间那块多行的输入面去扛，不由字号扛。
 *
 * 名字在顶栏上也有一处：那处答「这是哪个应用」，正中这处答「这一屏在做什么」，
 * 一小一大、一左一中。图标用放大镜，和顶栏那枚人像不同形——同一个图标在一屏上
 * 出现两次，看起来就是同一个东西摆了两遍。
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
		<Empty>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<SearchIcon />
				</EmptyMedia>
				{/* `EmptyTitle` 是个 `div`（coss 的文件一个字都不改），这一页的 h1
				    因此靠 ARIA 给，而不是在里面再套一个自己配一遍字号的 `<h1>`。 */}
				<EmptyTitle aria-level={1} role="heading">
					人才搜索
				</EmptyTitle>
			</EmptyHeader>

			{/* `EmptyContent` 原生是 `max-w-sm`（给按钮组用的宽度）。这里装的是
			    一句话的输入框，所以放宽到 `--container-hero`——改的是布局宽度，
			    不是组件内部的比例。 */}
			<EmptyContent className="max-w-hero gap-3">
				<QueryBar onQuery={onQuery} ref={bar} variant="hero" />

				{/* 提交失败时界面其余部分一切正常，不说的话人只会以为自己没点上。 */}
				{error && (
					<p className="text-destructive-foreground text-sm" role="alert">
						{error}
					</p>
				)}

				<div className="flex flex-wrap justify-center gap-2">
					{EXAMPLES.map((example) => (
						/*
						 * 点一条例子是**填进输入框**，不是直接搜。这两条是句式的样板，
						 * 要找的人几乎不会正好是这两句——填进去人才能把「线下渠道运营」
						 * 换成自己那个词再回车。
						 *
						 * 走 `outline` + `sm` 的原生档：例子是可点的东西，它就该长得像
						 * 这套系统里所有可点的东西——同一条顶光边、同一个按压态。
						 */
						<Button
							key={example}
							onClick={() => bar.current?.fill(example)}
							size="sm"
							variant="outline"
						>
							{example}
						</Button>
					))}
				</div>
			</EmptyContent>
		</Empty>
	);
}
