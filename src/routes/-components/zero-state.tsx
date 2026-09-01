import { Link } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { grouped, since } from "#/lib/format";
import type { QueryInput } from "#/search/parse";
import type { Overview } from "#/search/result";
import type { RecentSearch } from "#/server/turn";
import { QueryBar } from "./query-bar";

/**
 * 整句的例子。这两条各带一样词汇表给不了的东西：一句话里放多个条件，
 * 以及口语句式会被剥干净（「做过…的人」不必自己删）。
 * 单个词由下面那排从语料算出来的真实词汇负责，手写的示例不碰数据。
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
		// 版心和工作台同宽（`--container-page`），所以两屏之间左边缘不动。
		// `flex-1` 是为了让下面那个 12vh 的上边距有一个撑满视口的容器可依。
		<div className="mx-auto flex w-full max-w-page flex-1 flex-col px-4 pb-16">
			{/*
			 * 上四下六，不是正中：视觉重心高于几何中心才读得出「稳」。
			 * 用 `mt-[12vh]` 而不是 `justify-center`——内容长过视口时它退化成一个固定
			 * 上边距照样滚得到底，居中配 overflow 会把溢出的上半截裁掉且滚不回去。
			 */}
			<div className="mt-[12vh]">
				{/* 全站唯一的展示级标题，见 styles.css 的 display-1 */}
				<h2 className="display-1 font-semibold">搜索人才</h2>
				{/* 副标题说这个工具搜的是**经历**不是标签——不说的话，
				    第一句话很容易被敲成一个人名。 */}
				<p className="mt-2 text-muted-foreground text-sm">
					用一句话描述你要找的经历，逐条看命中在哪一段任职上。
				</p>

				<div className="mt-5">
					<QueryBar onQuery={onQuery} variant="hero" />
				</div>

				{/* 提交失败时界面其余部分一切正常，不说的话人只会以为自己没点上。 */}
				{error && (
					<p className="mt-2 text-destructive-foreground text-sm" role="alert">
						{error}
					</p>
				)}

				{/*
				 * 规模只说一句，只在这里说：不写的话，搜出 3 个人时没人分得清是词太窄
				 * 还是库本来就没几个人。段数一并给出——检索发生在经历上，不在花名册上。
				 */}
				{overview && (
					<p className="mt-2.5 text-muted-foreground text-xs">
						数据范围：
						<span className="tabular-nums">{grouped(overview.people)}</span>{" "}
						名员工 ·{" "}
						<span className="tabular-nums">{grouped(overview.segments)}</span>{" "}
						段经历
					</p>
				)}

				{/*
				 * 最近搜索。找人跨天，而只活在 URL 里的查询关掉标签页就没了——
				 * 这一块是「查询是一条记录」换来的。一条链只出现一行，停在它最后的
				 * 样子上（server/turn.ts 的 listRecent），否则五六条中间态会把同一件事
				 * 列六遍。
				 */}
				{recent.length > 0 && (
					<div className="mt-10">
						<p className="label text-muted-foreground">最近搜索</p>
						{/*
						 * 和候选人同一个 `Card`：点进去看到的就是那份名单，中间没有要学的
						 * 转换。内边距比候选人紧一档——这里一行只有条件和时间两样东西，
						 * 按五行证据的呼吸量去留白，五条记录就占满一屏。
						 */}
						<ul className="mt-2.5 flex flex-col gap-1.5">
							{recent.map((r) => (
								<li key={r.turnId}>
									<Card
										className="flex-row items-baseline gap-3 px-3.5 py-2.5 text-foreground no-underline transition-colors hoverable:hover:bg-accent/40"
										render={
											<Link params={{ turnId: r.turnId }} to="/s/$turnId" />
										}
									>
										{/* 条件是主行：点进去看到的就是这几枚 chip。 */}
										<span className="min-w-0 flex-1 truncate text-sm">
											{r.chips.map((c) => c.term).join(" · ")}
										</span>
										<span className="shrink-0 text-muted-foreground text-xs">
											{since(r.createdAt, now)}
										</span>
									</Card>
								</li>
							))}
						</ul>
					</div>
				)}

				{/*
				 * 语料的词汇表。零态真正的问题不是「不知道怎么用」，是**不知道该输入
				 * 什么**——那是词汇问题，例子解决不了，只有语料自己能回答。
				 */}
				{overview && overview.seqs.length > 0 && (
					<div className="mt-10">
						<p className="label text-muted-foreground">常用方向</p>
						<div className="mt-2.5 flex flex-wrap gap-1.5">
							{overview.seqs.map((seq) => (
								/* 和查询 chip 同一个组件、同一个尺码（query-chips.tsx）：
								   点下去得到的正是那一枚 chip。 */
								<Button
									key={seq}
									onClick={() =>
										onQuery({
											kind: "chips",
											chips: [{ term: seq, mode: "must" }],
										})
									}
									size="xs"
									variant="secondary"
								>
									{seq}
								</Button>
							))}
						</div>
					</div>
				)}

				<div className="mt-10">
					<p className="label text-muted-foreground">搜索示例</p>
					<div className="mt-2.5 flex flex-wrap gap-2">
						{EXAMPLES.map((ex) => (
							/*
							 * 点一条示例直接搜，不是填进输入框：例子要回答的是「一句大白话
							 * 进去会变成什么」，那件事只有搜出来才看得见。敢这么做是因为背后
							 * 只有一次 INSERT——理解那一跳在工作台里补（`s/$turnId/route.tsx`），
							 * 否则这颗按钮会替模型转上几十秒。
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
