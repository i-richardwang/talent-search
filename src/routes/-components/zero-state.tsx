import { Button, Text } from "@cloudflare/kumo";
import { Link } from "@tanstack/react-router";
import { grouped, since } from "#/lib/format";
import type { QueryInput } from "#/search/parse";
import type { Overview } from "#/search/result";
import type { RecentSearch } from "#/server/turn";
import { QueryBar } from "./query-bar";

/**
 * 整句的例子。留下的两条各带一样东西是词汇表给不了的：**一句话里放多个条件**，
 * 以及**口语句式会被剥干净**（「做过…的人」不必自己删）。
 *
 * 单个词由下面从语料计算出的真实词汇提供，手写示例只表达语料无法给出的句式，
 * 避免示例随数据变化而失效。
 */
const EXAMPLES = ["做过线下渠道运营、带过团队的人", "算法、产品、后端都做过的"];

export function ZeroState({
	onQuery,
	pending,
	error,
	overview,
	recent,
}: {
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	/** 正在飞的那一句。示例按钮靠它认出该转圈的是哪一条。 */
	pending: string | null;
	error: string | null;
	/** 语料概览。取不到时（库是空的）下面两段自己消失，不占位。 */
	overview: Overview | null;
	recent: RecentSearch[];
}) {
	/*
	 * 时钟只读一次，读在渲染这一层。`since` 自己是纯函数（见 lib/format），
	 * 时刻由这里给——否则列表里每一行各读一次时钟，SSR 和水合两侧的取值
	 * 必然不同，整个列表会被 React 判为不一致重画。
	 */
	const now = Date.now();

	return (
		/*
		 * 垂直居中用子元素的 `my-auto`，不用父元素的 `items-center`。
		 * `items-center` 配上 `overflow-y-auto` 时，内容一旦高过容器，
		 * 溢出的上半截会被裁掉且滚不回去——矮视口下标题就没了。
		 * `my-auto` 在有余量时照样居中，没余量时退化成 0，内容完整可滚。
		 */
		<div className="flex flex-1 justify-center overflow-y-auto px-6 py-8">
			<div className="my-auto w-full max-w-xl pb-8">
				{/* 全站唯一的展示级标题：不走 Kumo 的密集四档，见 styles.css 的 display-1 */}
				<h2 className="display-1 font-semibold text-kumo-default">搜索人才</h2>

				<div className="mt-6">
					<QueryBar onQuery={onQuery} variant="hero" />
				</div>

				{/*
				 * 提交失败要说出来。这一跳会失败（网络、服务端、库），而它失败时
				 * 界面上其余部分一切正常——不说的话人只会以为自己没点上，再点一次。
				 */}
				{error && (
					<p className="mt-2 text-kumo-danger text-sm" role="alert">
						{error}
					</p>
				)}

				{/*
				 * 规模只说一句，而且只在这里说。
				 *
				 * 它回答的是「这个库覆盖到哪」——不写的话，搜出 3 个人时没人分得清
				 * 是这个词太窄还是整个库就没几个人。段数一并给出：这个工具搜的是
				 * 经历，不是花名册，两个数一起才说明白它在什么之上做检索。
				 */}
				{overview && (
					// mt 挂在外层：Kumo 的 `Text` 刻意不收 className
					<div className="mt-2">
						<Text as="p" size="xs" variant="secondary">
							数据范围：
							<span className="tabular-nums">{grouped(overview.people)}</span>{" "}
							名员工 ·{" "}
							<span className="tabular-nums">{grouped(overview.segments)}</span>{" "}
							段经历
						</Text>
					</div>
				)}

				{/*
				 * 最近搜索。查询是一条**记录**才可能有这一块：找人这件事本来就
				 * 跨天，「昨天给这个岗位筛的那批人」是 HR 最常要回到的地方，
				 * 而只活在 URL 里的查询关掉标签页就没了。
				 *
				 * 一条链只出现一行，停在它最后的样子上（见 server/turn.ts 的
				 * listRecent）：一次搜索派生出的五六条中间态全列出来，
				 * 列表读起来就是同一件事重复了六遍。
				 */}
				{recent.length > 0 && (
					<div className="mt-8">
						<Text as="p" size="xs" variant="secondary">
							最近搜索
						</Text>
						<ul className="mt-2 flex flex-col">
							{recent.map((r) => (
								<li key={r.turnId}>
									<Link
										className="-mx-2 flex items-baseline gap-3 rounded-control px-2 py-1.5 text-kumo-default no-underline [@media(hover:hover)]:hover:bg-kumo-fill"
										params={{ turnId: r.turnId }}
										to="/s/$turnId"
									>
										{/*
										 * 条件是主行：点进去看到的就是这几枚 chip，
										 * 两处长一个样，中间没有要学的转换。
										 */}
										<span className="min-w-0 flex-1 truncate text-sm">
											{r.chips.map((c) => c.term).join(" · ")}
										</span>
										<Text as="span" size="xs" variant="secondary">
											{since(r.createdAt, now)}
										</Text>
									</Link>
								</li>
							))}
						</ul>
					</div>
				)}

				{/*
				 * 语料的词汇表。零态真正要解决的问题不是「不知道怎么用」，
				 * 是**不知道该输入什么**——那是一个词汇问题，例子解决不了，
				 * 只有语料自己能回答。
				 *
				 * 它们长得像查询 chip，因为点下去得到的正是那一枚 chip：
				 * 同一个东西在两个地方长同一个样子，中间没有需要学的转换。
				 */}
				{overview && overview.seqs.length > 0 && (
					<div className="mt-6">
						<Text as="p" size="xs" variant="secondary">
							常用方向
						</Text>
						<div className="mt-2 flex flex-wrap gap-1.5">
							{overview.seqs.map((seq) => (
								<button
									/* 尺寸**和字号**都跟着查询 chip 走（query-chips.tsx）：
									   点下去得到的正是那一枚 chip，两处长得不一样就多出一次
									   要学的转换。所以这里是 12px + px-2.5 py-1 = 24px 高，
									   一个像素都不许差；命中区仍然由伪元素撑到 40px。 */
									className="relative rounded-control bg-kumo-fill px-2.5 py-1 text-kumo-default text-xs after:pointer-events-none after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] [@media(hover:hover)]:hover:brightness-95"
									key={seq}
									onClick={() =>
										onQuery({
											kind: "chips",
											chips: [{ term: seq, mode: "must" }],
										})
									}
									type="button"
								>
									{seq}
								</button>
							))}
						</div>
					</div>
				)}

				<div className="mt-6">
					<Text as="p" size="xs" variant="secondary">
						搜索示例
					</Text>
					<div className="mt-2 flex flex-wrap gap-2">
						{EXAMPLES.map((ex) => (
							/*
							 * 点一条示例就直接搜，不是把它填进输入框——例子的意义是
							 * 「一句大白话进去会变成什么」，而那件事只有搜出来才看得见。
							 *
							 * 敢这么做的前提是背后只有一次 INSERT：理解那一跳在工作台里
							 * 补（见 `s/$turnId/route.tsx`），所以这颗按钮上的转圈只覆盖
							 * 一次毫秒级往返。要是它等的是模型，人看到的就是整屏不动、
							 * 只有一颗按钮在转——首页卡住了。
							 */
							<Button
								disabled={pending !== null && pending !== ex}
								key={ex}
								loading={pending === ex}
								onClick={() => onQuery({ kind: "sentence", text: ex })}
								variant="outline"
							>
								{ex}
							</Button>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
