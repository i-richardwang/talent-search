import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import { Frame, FramePanel } from "#/components/ui/frame";
import { SheetDescription } from "#/components/ui/sheet";
import { INVOLVEMENTS } from "#/corpus/involvement";
import { dots, duration, period } from "#/lib/format";
import type { SegmentView } from "#/server/data";
import { dataEmployee } from "#/server/functions";
import { DetailSheet, Fact } from "./-components/detail-sheet";
import { StatusBadge } from "./-components/status-badge";

/**
 * 一个人的每一段经历：登记的字段和解析出的结果并排展示。
 *
 * 用抽屉从右侧覆盖，而不是跳转到新页面。管理数据的人是顺着表往下看的——看一个、
 * 回到表、再看下一个；跳页的话每次返回，表格都已经滚回顶部。抽屉底下的表保持
 * 原样，关掉就能接着刚才那一行继续。
 *
 * 每一段展示四件事：登记的内容（同步写入）、推断的序列归属、抽取出的能力词和做过
 * 的事（派生写入），以及这一段有没有派生到当前版本——没有的话下面那些是上一版的
 * 结果。只列这一段真有的，空的那几项整行不出现。
 */
export const Route = createFileRoute("/data/$empId")({
	loader: async ({ params }) => {
		const data = await dataEmployee({ data: { empId: params.empId } });
		if (!data) throw notFound();
		return data;
	},
	component: Person,
	notFoundComponent: () => (
		<PersonSheet title="没有这个工号">
			<Empty>
				<EmptyHeader>
					<EmptyTitle>找不到这位员工</EmptyTitle>
					<EmptyDescription>
						工号可能写错了，或者还没有同步到数据。
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</PersonSheet>
	),
});

/**
 * 这一层的壳，**真身和「没有这个工号」共用**——两处各写一遍回列表的路的话，改一次
 * 就会有一处忘掉。开合与动画归 `DetailSheet`（技能页点一个词用的是同一件东西）。
 */
function PersonSheet({
	title,
	description,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	children: ReactNode;
}) {
	const navigate = useNavigate();
	// 关掉抽屉是回到刚才那张表，所以词和页码原样带回去
	const search = Route.useSearch();
	return (
		<DetailSheet
			/* 表里的段落带着组织路径，28rem 一行放不下几个字，给到详情栏宽的那一档 */
			className="sm:max-w-detail-wide"
			close={() => void navigate({ search, to: "/data" })}
			description={description}
			title={title}
		>
			{children}
		</DetailSheet>
	);
}

function Person() {
	const { employee, segments } = Route.useLoaderData();
	return (
		<PersonSheet
			description={
				<>
					<SheetDescription>
						{dots(
							employee.curDept,
							employee.curTitle,
							employee.curLevel,
							[employee.curSeqL1, employee.curSeqL2, employee.curSeqL3]
								.filter(Boolean)
								.join(" · "),
						)}
					</SheetDescription>
					<p className="text-muted-foreground text-xs">
						{dots(
							employee.hireDate ? `${employee.hireDate} 入职` : null,
							employee.recruitment,
							employee.educationLevel,
							employee.school,
						)}
					</p>
				</>
			}
			title={
				<>
					{employee.name}
					<span className="ms-2 font-mono font-normal text-muted-foreground text-sm">
						{employee.empId}
					</span>
				</>
			}
		>
			{segments.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>还没有经历记录</EmptyTitle>
						<EmptyDescription>
							名下还没有经历记录，请联系管理员。
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="flex flex-col gap-5">
					{KINDS.map(([kind, label]) => {
						const part = segments.filter((one) => one.kind === kind);
						return part.length === 0 ? null : (
							<section className="flex flex-col gap-2" key={kind}>
								<h3 className="label text-muted-foreground">
									{label} · {part.length} 段
								</h3>
								{/*
								 * 一组是托盘里的一摞面（`Frame`，排法照上游 `p-frame-3`）：这些段
								 * 是同一个人的一份档案，一段接一段往下读，而面与面之间透出来的
								 * 那几毫米托盘色说的正是「还在同一份里」。
								 */}
								<Frame>
									{part.map((segment) => (
										<Segment key={segment.id} segment={segment} />
									))}
								</Frame>
							</section>
						);
					})}
				</div>
			)}
		</PersonSheet>
	);
}

/**
 * 两组各叫什么，以及先画哪一组。
 *
 * 分界来自 `kind` 这个字段，不从入职日推：库里有一千多段内部经历的开始日期
 * 早于入职日（并购、外包转正、实习转正都会这样），拿入职日画一条线会把它们
 * 放到「入职前」那一边——一条会把段放错边的线，比没有线更坏。
 *
 * 标题一组画一次，不是每段贴一个标签：库里两万多段是内部的，给每一段发一块
 * 徽章就是在两万个常态上重复同一个词，真正要分辨的那几段反而不显眼。
 *
 * 用词和搜索结果那边的证据行一致（`components/evidence.tsx`）：那里写「公司内
 * 2.3 年」「入职前 2.9 年」，同一件事在两个页面不该有两个说法。
 */
const KINDS = [
	["external", "入职前"],
	["internal", "公司内"],
] as const;

/**
 * 做过的事，按参与方式归组。
 *
 * 平铺成一句是「优化改进 · 产品、负责建设 · 产品体系、优化改进 · 合规率、优化
 * 改进 · 城市运力」——四个字的前缀读了三遍，而真正不同的那几个名词排在后面，
 * 每一个都要先跨过一个已经读过的词才能读到。归组之后每种参与方式说一次，
 * 和经历分内外那里（`KINDS`）同一个办法：一组画一次标题，不是每条贴一个标签。
 *
 * 参与方式和领域之间那个 ` · ` 一并去掉了。这一套界面里的分隔点说的是「两边
 * 是同一类、可以并列」（序列三级、岗位和公司），而这两半不并列：一个是做的
 * 那件事，一个是他和这件事的关系。分层靠位置和降一档的字色给，和证据行上
 * 接部门名同一条规矩（`components/evidence.tsx`）。
 *
 * 参与方式**不参与检索**——它不进向量，理由见 `db/schema.ts` 的 `involvement`
 * 列（拼进说法的话，同一种参与方式的任何领域在重排模型眼里都相近）。它留在
 * 屏幕上是因为读的人用得着：负责建设和参与执行是两回事。
 *
 * 组的先后照抽取那份清单的原序（`corpus/involvement.ts`）；清单里没有的取值
 * 和模型没判断出参与方式的排在最后，左边那一格空着——我们确实不知道。
 * 不按清单过滤而是按出现的值分组，是因为按清单过滤会让一个意外的取值**整条
 * 消失**，而这一页存在的理由正是「库里到底是什么」。
 */
function didGroups(did: SegmentView["did"]) {
	const order = (one: string | null) => {
		const at = one === null ? -1 : INVOLVEMENTS.indexOf(one);
		return at === -1 ? INVOLVEMENTS.length : at;
	};
	const kinds = [...new Set(did.map((one) => one.involvement))].sort(
		(a, b) => order(a) - order(b),
	);
	return (
		<div className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1">
			{kinds.map((kind) => (
				<Fragment key={kind ?? ""}>
					<span className="text-muted-foreground">{kind}</span>
					<span>
						{did
							.filter((one) => one.involvement === kind)
							.map((one) => one.domain)
							.join("、")}
					</span>
				</Fragment>
			))}
		</div>
	);
}

function Segment({ segment: s }: { segment: SegmentView }) {
	const registered = [s.seqL1, s.seqL2, s.seqL3].filter(Boolean).join(" · ");
	const inferred = [s.seqInferredL1, s.seqInferredL2]
		.filter(Boolean)
		.join(" · ");
	return (
		<FramePanel className="flex flex-col gap-3 text-sm">
			<div className="flex items-start justify-between gap-2">
				<div className="flex flex-col gap-0.5">
					<p className="font-medium">
						{s.title || "（无岗位）"}
						<span className="ms-2 font-normal text-muted-foreground">
							{s.kind === "internal" ? s.orgPath || s.org : s.org}
						</span>
					</p>
					<p className="text-muted-foreground text-xs tabular-nums">
						{dots(period(s.startDate, s.endDate), duration(s.months), s.level)}
					</p>
				</div>
				{/*
				 * 徽章只在待处理时出现。已处理是这一页上绝大多数段的常态，给常态
				 * 也发徽章的话，一栏里会是十几块相同的绿色，真正需要注意的那一段反而
				 * 不显眼。
				 *
				 * 「什么时候派生的」不出现在这一页上：上面那行小字说的是这个人的经历
				 * （何时、多久、什么职级），派生时刻说的是我们这边跑了什么，混在一起会
				 * 被当成同一类事实读。何况它答不出任何问题：派生到当前版本，结果就是当前
				 * 版本的，跑在哪一分钟不改变这一点；没派生到的那一支根本不显示时刻。
				 */}
				{!s.derived && <StatusBadge tone="waiting">待处理</StatusBadge>}
			</div>
			{/*
			 * 事实网格只列这一段真有的东西。内部任职段没有自述可读，能力词和做过的事
			 * 在这类段上必然是空的——一整栏「无」既占地方，又把「这一段没写」说成
			 * 「这一段查过了没有」。没有就不出现这一行；四行都没有就连网格一起不要，
			 * 免得空元素还占着一档行距。
			 */}
			{(registered ||
				inferred ||
				s.skills.length > 0 ||
				s.did.length > 0 ||
				s.description) && (
				<dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-xs">
					{(registered || inferred) && (
						<Fact label="序列">
							{registered || (
								<>
									{inferred}
									<span className="text-muted-foreground">（推断）</span>
								</>
							)}
						</Fact>
					)}
					{s.skills.length > 0 && (
						<Fact label="技能">{s.skills.join("、")}</Fact>
					)}
					{s.did.length > 0 && <Fact label="职责">{didGroups(s.did)}</Fact>}
					{s.description && (
						/* 简历原文是这一栏里唯一成段读的东西，行高走 `read-cjk` 那一档 */
						<Fact label="描述">
							<span className="read-cjk block">{s.description}</span>
						</Fact>
					)}
				</dl>
			)}
		</FramePanel>
	);
}
