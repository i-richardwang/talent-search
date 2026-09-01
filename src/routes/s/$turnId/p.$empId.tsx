import {
	createFileRoute,
	Link,
	notFound,
	useLoaderData,
} from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { CareerBar } from "#/components/career-bar";
import { Dot, ROUTE_LABEL } from "#/components/evidence";
import { buildHitIndex, Timeline } from "#/components/timeline";
import { buttonVariants } from "#/components/ui/button";
import { Separator } from "#/components/ui/separator";
import { Skeleton } from "#/components/ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip";
import { duration, seqLabel } from "#/lib/format";
import { strengthOf } from "#/search/evidence";
import { fetchEmployee } from "#/server/functions";

export const Route = createFileRoute("/s/$turnId/p/$empId")({
	loader: async ({ params }) => {
		const data = await fetchEmployee({ data: { empId: params.empId } });
		if (!data) throw notFound();
		return data;
	},
	component: Person,
	/*
	 * 找不到工号时**只换这一栏**：外壳、检索结果、筛选、查询框全都留着。
	 *
	 * 这条要挂在本路由上，不能挂到 `/s/$turnId`。`notFound()` 由抛它的那个
	 * loader 所属的路由自己接住；挂到外壳那一层会让整个页面被这一句话替换掉，
	 * 连同旁边那份还成立的名单。
	 */
	notFoundComponent: DetailNotFound,
	/*
	 * 这块面板开着的时候一直在，而它的 loader 要打一次库。没有 pending 表示的话，
	 * ↑↓ 连着扫人时屏幕上挂的是**上一个人**，直到新数据回来才整块换掉——
	 * 库一慢就是「按了没反应，然后突然换人」。
	 *
	 * 200ms 才开始画骨架：快过这个数的话闪一下骨架比直接换人更晃眼。
	 * 画出来就至少留 300ms，免得它在人眼刚注意到的一瞬间消失。
	 */
	pendingMs: 200,
	pendingMinMs: 300,
	pendingComponent: PersonPending,
});

/**
 * 换人途中的详情面板。头的高度必须和真正的头一模一样——面板开着的时候换人是
 * 连着做的，顶部每换一次跳一下就会被反复看到。
 *
 * 所以骨架块住在真正那两个标签里，高度用 `h-lh` 取各自的行高：字阶改了它跟着改，
 * 不必回来对一个像素值。
 */
function PersonPending() {
	return (
		<div className="pb-12" data-pane="detail">
			<div className="sticky top-0 z-stick border-border border-b bg-card px-5 py-4">
				<h2 className="title-1">
					<Skeleton className="h-lh w-32" />
				</h2>
				<p className="mt-0.5 text-sm">
					<Skeleton className="h-lh w-48" />
				</p>
			</div>
			<div className="flex flex-col gap-3 px-5 py-5">
				<Skeleton className="h-3 w-48" />
				<Skeleton className="h-3 w-full" />
				<Skeleton className="h-3 w-5/6" />
			</div>
		</div>
	);
}

function DetailNotFound() {
	return (
		<div className="px-5 py-10 text-center">
			<p className="text-muted-foreground text-sm">未找到这位员工</p>
			<p className="text-muted-foreground text-xs">
				该员工记录不存在或已失效。
			</p>
		</div>
	);
}

function Person() {
	const { employee: e, timeline } = Route.useLoaderData();
	// 命中证据来自父路由已经拿到的检索结果——不为了标记而再查一次库
	const { result: search } = useLoaderData({ from: "/s/$turnId" });
	const rank =
		search?.results.findIndex((r) => r.employee.empId === e.empId) ?? -1;
	const result = rank >= 0 ? search?.results[rank] : undefined;
	const terms = search?.terms ?? [];
	// 轨迹条和时间轴共用：一份索引，两个视图
	const hitIndex = buildHitIndex(result?.hits ?? []);

	return (
		/*
		 * key + settle：↑↓ 连着换人时，这一栏整体淡入一次，给出「换了一个人」
		 * 的确认。这是全站唯一的动效——名单那边靠选中态本身说话，不再叠第二个。
		 * 动画短到 160ms，因为它必须在下一次按键之前结束。
		 */
		<div className="settle pb-12" data-pane="detail" key={e.empId}>
			{/*
			 * 面板自己的头，吸在面板顶上。
			 *
			 * 高度由内容决定，不去凑一个固定值：这块面板没有并排的邻居要对齐，
			 * 而姓名是它的锚点，值得占满一行 22px，不该塞进一条为别人定的高度里。
			 *
			 * 姓名和工号一起吸顶，其余全部交给下面滚。滚到第八段经历时还需要
			 * 一直在的，只有「我在看谁」。
			 */}
			<div className="sticky top-0 z-stick flex items-start justify-between gap-2 border-border border-b bg-card px-5 py-4">
				<div className="min-w-0">
					{/*
					 * 全站最重的一档字，只此一处。它必须比周围重两档以上，
					 * 否则这一块读起来是一张字号全同的表单打印件。
					 */}
					<h2 className="title-1 truncate font-semibold">{e.name}</h2>
					<p className="mt-0.5 truncate text-muted-foreground text-sm">
						<span className="font-mono">{e.empId}</span>
						{" · "}
						{e.curDept} · {e.curTitle}
						{e.curLevel && ` · ${e.curLevel}`}
					</p>
				</div>
				{/* 用 Link 本身当按钮：<a> 里嵌 <button> 是非法嵌套。
				    触控目标由 buttonVariants 里的 pointer-coarse 规则撑开。 */}
				<Tooltip>
					<TooltipTrigger
						render={
							<Link
								aria-label="关闭详情"
								className={buttonVariants({
									className: "-mr-1 text-muted-foreground no-underline",
									size: "icon-sm",
									variant: "ghost",
								})}
								from="/s/$turnId/p/$empId"
								params={(prev) => prev}
								replace
								search={(prev) => prev}
								to="/s/$turnId"
							>
								<XIcon />
							</Link>
						}
					/>
					<TooltipPopup>关闭详情（Esc）</TooltipPopup>
				</Tooltip>
			</div>

			<div className="px-5 pt-5">
				<dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
					<Fact label="当前序列">
						{seqLabel(e.curSeqL1, e.curSeqL2, e.curSeqL3) || "—"}
					</Fact>
					{/* 日期用等宽数字：时间轴上的年月也是这个待遇，
					    同一个人的两处日期不该一处对得齐、一处对不齐 */}
					<Fact label="入职时间">
						<span className="tabular-nums">{e.hireDate ?? "—"}</span>
					</Fact>
					<Fact label="招聘来源">{e.recruitment || "—"}</Fact>
					<Fact label="教育背景">
						{[e.educationLevel, e.school].filter(Boolean).join(" · ") || "—"}
					</Fact>
				</dl>

				{/*
				 * 「这个词的证据有多硬」在这一段里只画一遍：每条行首那颗点，
				 * 和证据行、时间轴、图例是同一颗。再给一个按强度上色的 Badge，
				 * 就成了点、颜色、route 名把同一件事画三遍。
				 */}
				{result && terms.length > 0 && (
					<Section title="匹配依据">
						{/*
						 * 名次写在证据前面。
						 *
						 * 那份名单是按分排的，但分数本身不上屏：它是路权重 × 时长因子
						 * 再乘上加分项的积，没有任何刻度让人校准「1.35 算高还是低」，
						 * 摆上去只是一个看着精确、读不出意思的数。名次不一样——它有刻度
						 * （分母就在旁边），而分数由什么构成，下面这几行逐词说得比数清楚。
						 */}
						<p className="text-muted-foreground text-xs">
							本次结果第 <b className="tabular-nums">{rank + 1}</b> 位，共{" "}
							<b className="tabular-nums">{search?.total ?? 0}</b> 人
						</p>
						<ul className="mt-2 space-y-2">
							{terms.map((t, i) => {
								const basis = result.basis[i];
								const primaryRoute = basis?.routes[0];
								return (
									<li className="flex items-baseline gap-2" key={t.term}>
										<Dot
											className="translate-y-1"
											strength={
												primaryRoute ? strengthOf(primaryRoute) : undefined
											}
										/>
										<span className="text-sm">{t.term}</span>
										<span className="text-muted-foreground text-xs">
											{basis
												? `${basis.routes.map((route) => ROUTE_LABEL[route]).join("、")} · 累计 ${duration(basis.months)} · ${basis.endDate ? `最近至 ${basis.endDate.slice(0, 7)}` : "目前仍有相关经历"}`
												: "未匹配"}
										</span>
									</li>
								);
							})}
						</ul>
					</Section>
				)}

				<Section title="任职经历">
					{/*
					 * 先给形状，再给细节：轨迹条一眼看出这个人在哪几年、跨了几家、
					 * 命中的那段落在职业生涯的什么位置，卡片回答那一段具体是什么。
					 * 两者共用同一份 hitIndex，所以「哪几段命中」只算一次。
					 */}
					<CareerBar
						hireDate={e.hireDate}
						hitIndex={hitIndex}
						rows={timeline}
					/>
					<Timeline hitIndex={hitIndex} rows={timeline} />
				</Section>
			</div>
		</div>
	);
}

/**
 * 分区靠一条发丝线和小标题，不靠再嵌一层带底色的卡片——这块面板自己
 * 就是 card 那一层底，里面再叠一层就是背景打架。
 */
function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="mt-7">
			<Separator />
			{/* 分区标签走 `label` 档（11px / 600 / 放开字距，见 styles.css）：
			    它必须一眼被认成「不是内容」，而正文里的次要信息也是 12px 次要色，
			    只靠字号和颜色分不开。 */}
			<h3 className="label mt-4 text-muted-foreground">{title}</h3>
			<div className="mt-2.5">{children}</div>
		</section>
	);
}

function Fact({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<dt className="label text-muted-foreground">{label}</dt>
			<dd className="mt-0.5 text-sm">{children}</dd>
		</div>
	);
}
