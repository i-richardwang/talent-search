import { SkeletonLine, Text, Tooltip } from "@cloudflare/kumo";
import { XIcon } from "@phosphor-icons/react";
import {
	createFileRoute,
	Link,
	notFound,
	useLoaderData,
} from "@tanstack/react-router";
import { duration, seqLabel } from "#/lib/format";
import { strengthOf } from "#/search/evidence";
import { fetchEmployee } from "#/server/functions";
import { CareerBar } from "../../-components/career-bar";
import { Dot, ROUTE_LABEL } from "../../-components/evidence";
import { buildHitIndex, Timeline } from "../../-components/timeline";

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
	 * loader 所属的路由自己接住；挂到外壳那一层会让整个三栏被这一句话替换掉，
	 * 而这里的文案还写着「左边的结果还在」。
	 */
	notFoundComponent: DetailNotFound,
	/*
	 * 这一栏是常驻的，而它的 loader 要打一次库。没有 pending 表示的话，
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
 * 换人途中的详情栏。头保持 56px 那一条不动——这一栏是常驻的，
 * 顶部一跳就会被反复看到。
 */
function PersonPending() {
	return (
		<div className="pb-10" data-pane="detail">
			<div className="sticky top-0 z-stick flex h-14 items-center border-kumo-hairline border-b bg-kumo-base px-4">
				<SkeletonLine className="h-4 w-32" />
			</div>
			<div className="flex flex-col gap-3 px-4 py-4">
				<SkeletonLine className="h-3 w-48" />
				<SkeletonLine className="h-3 w-full" />
				<SkeletonLine className="h-3 w-5/6" />
			</div>
		</div>
	);
}

function DetailNotFound() {
	return (
		<div className="px-4 py-10 text-center">
			<Text as="p" size="sm" variant="secondary">
				未找到这位员工
			</Text>
			<Text as="p" size="xs" variant="secondary">
				该员工记录不存在或已失效。
			</Text>
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
		 * key + settle 是签名微交互的另一半：↑↓ 连着换人时，这一栏整体
		 * 淡入一次，给出「换了一个人」的确认。另一半是中栏那根平移的选中轨。
		 * 动画短到 160ms，因为它必须在下一次按键之前结束。
		 */
		<div className="settle pb-10" data-pane="detail" key={e.empId}>
			{/*
			 * 详情栏自己的头：滚动时姓名和关闭按钮不能跟着走。
			 *
			 * 56px 一行，和左边那条结果头、以及画布上的顶栏是同一个高度。它们三个
			 * 的下边缘必须落在同一条水平线上——两块并排的面板各画一条高度差十几像素
			 * 的横线，是「这界面没人量过」最直接的证据。
			 *
			 * 高度定死一行，所以「部门 · 岗位 · 职级」挪到了下面正文的第一行：
			 * 它是这个人的属性，和下面那张属性表是同一类东西，本来就不必挤进
			 * 一个吸顶的条里跟着滚一路。
			 */}
			<div className="sticky top-0 z-stick flex h-14 items-center justify-between gap-2 border-kumo-hairline border-b bg-kumo-base px-4">
				<div className="min-w-0">
					<div className="flex items-baseline gap-x-2">
						{/*
						 * 姓名是这一栏唯一的锚点，必须比周围重两档以上，否则详情栏
						 * 读起来是一张字号全同的表单打印件。Kumo 的 Text 是给密集界面
						 * 的四档（12/13/14/16），最大 16px 撑不起这个位置，而它又不收
						 * className——所以这一处落到原生 h2 上，走 Tailwind 的 20px。
						 * 全站只此一处，加一处要先回答「为什么它也是这一栏的锚点」。
						 */}
						<h2 className="truncate font-semibold text-kumo-strong text-xl">
							{e.name}
						</h2>
						<Text as="span" variant="mono-secondary">
							{e.empId}
						</Text>
					</div>
				</div>
				{/* 用 Link 本身当按钮：<a> 里嵌 <button> 是非法嵌套 */}
				<Tooltip
					content="关闭详情（Esc）"
					render={
						<Link
							aria-label="关闭详情"
							/* 视觉 32px，命中区 40px：小控件不该按尺寸缩水触控目标，
							   用一个伪元素往外撑，不影响布局 */
							className="-mr-1 relative flex size-8 shrink-0 items-center justify-center rounded-control text-kumo-subtle no-underline after:absolute after:-inset-1 after:content-[''] [@media(hover:hover)]:hover:bg-kumo-fill [@media(hover:hover)]:hover:text-kumo-default"
							from="/s/$turnId/p/$empId"
							params={(prev) => prev}
							replace
							search={(prev) => prev}
							to="/s/$turnId"
						/>
					}
				>
					<XIcon size={16} />
				</Tooltip>
			</div>

			<div className="px-4">
				{/* 当前任职：从吸顶的头里挪下来的那一行，见上 */}
				<div className="mt-4">
					<Text as="p" size="sm" variant="secondary">
						{e.curDept} · {e.curTitle}
						{e.curLevel && ` · ${e.curLevel}`}
					</Text>
				</div>

				<dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
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
				 * 和表格、时间轴、图例是同一颗。再给一个按强度上色的 Badge，
				 * 就成了点、颜色、route 名把同一件事画三遍。
				 */}
				{result && terms.length > 0 && (
					<Section title="匹配依据">
						{/*
						 * 名次写在证据前面。
						 *
						 * 中栏那张表是按分排的，但分数本身不上表：它是路权重 × 时长因子
						 * 再乘上加分项的积，没有任何刻度让人校准「1.35 算高还是低」，
						 * 摆上去只是一列看着精确、读不出意思的数。名次不一样——它有刻度
						 * （分母就在旁边），而分数由什么构成，下面这几行逐词说得比数清楚。
						 */}
						<Text as="p" size="xs" variant="secondary">
							本次结果第 <b className="tabular-nums">{rank + 1}</b> 位，共{" "}
							<b className="tabular-nums">{search?.total ?? 0}</b> 人
						</Text>
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
										<Text as="span" size="base">
											{t.term}
										</Text>
										<Text as="span" size="xs" variant="secondary">
											{basis
												? `${basis.routes.map((route) => ROUTE_LABEL[route]).join("、")} · 累计 ${duration(basis.months)} · ${basis.endDate ? `最近至 ${basis.endDate.slice(0, 7)}` : "目前仍有相关经历"}`
												: "未匹配"}
										</Text>
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
 * 分区靠一条发丝线和小标题，不靠再嵌一层带底色的卡片——详情栏本身
 * 已经是一个 base 面板，里面再叠 elevated 就是背景打架。
 */
function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="mt-6 border-kumo-hairline border-t pt-4">
			<Text as="h3" bold size="sm" variant="secondary">
				{title}
			</Text>
			<div className="mt-2">{children}</div>
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
			<Text as="dt" size="xs" variant="secondary">
				{label}
			</Text>
			<Text as="dd" size="base">
				{children}
			</Text>
		</div>
	);
}
