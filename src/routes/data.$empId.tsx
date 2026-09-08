import { createFileRoute, notFound } from "@tanstack/react-router";
import { Badge } from "#/components/ui/badge";
import { Card } from "#/components/ui/card";
import { dots, duration, period } from "#/lib/format";
import type { SegmentView } from "#/server/data";
import { dataEmployee } from "#/server/functions";

/**
 * 一个人的每一段，原始的一半和派生的一半并排放着。
 *
 * 这一栏开在列表右边，换人不丢列表和找人的词。每一段说四件事：登记的是什么
 * （同步写的）、对到了哪个序列、抽出了哪些能力词和做过的事（派生写的）、以及
 * 这一段派生到当前版本了没有——没有的话下面那些是上一版的，或者还是空的。
 */
export const Route = createFileRoute("/data/$empId")({
	loader: async ({ params }) => {
		const data = await dataEmployee({ data: { empId: params.empId } });
		if (!data) throw notFound();
		return data;
	},
	component: Person,
	notFoundComponent: () => (
		<aside className="w-detail shrink-0 text-muted-foreground text-sm">
			没有这个工号。
		</aside>
	),
});

function Person() {
	const { employee, segments } = Route.useLoaderData();
	return (
		<aside className="flex w-detail shrink-0 flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="title-2 font-semibold">
					{employee.name}
					<span className="ms-2 font-normal text-muted-foreground text-sm tabular-nums">
						{employee.empId}
					</span>
				</h2>
				<p className="text-muted-foreground text-sm">
					{dots(
						employee.curDept,
						employee.curTitle,
						employee.curLevel,
						[employee.curSeqL1, employee.curSeqL2, employee.curSeqL3]
							.filter(Boolean)
							.join(" · "),
					)}
				</p>
				<p className="text-muted-foreground text-xs">
					{dots(
						employee.hireDate ? `${employee.hireDate} 入职` : null,
						employee.recruitment,
						employee.educationLevel,
						employee.school,
					)}
				</p>
			</div>
			{segments.map((segment) => (
				<Segment key={segment.id} segment={segment} />
			))}
		</aside>
	);
}

function Segment({ segment: s }: { segment: SegmentView }) {
	const registered = [s.seqL1, s.seqL2, s.seqL3].filter(Boolean).join(" · ");
	const inferred = [s.seqInferredL1, s.seqInferredL2]
		.filter(Boolean)
		.join(" · ");
	return (
		<Card className="flex flex-col gap-3 p-4 text-sm">
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
				<Badge variant={s.derived ? "success" : "warning"}>
					{s.derived ? `派生于 ${s.derivedAt}` : "待派生"}
				</Badge>
			</div>
			<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
				<dt className="text-muted-foreground">序列</dt>
				<dd>
					{registered ||
						(inferred ? (
							<>
								{inferred}
								<span className="text-muted-foreground">（对齐）</span>
							</>
						) : (
							<span className="text-muted-foreground">无</span>
						))}
				</dd>
				<dt className="text-muted-foreground">能力词</dt>
				<dd>
					{s.skills.length ? (
						s.skills.join("、")
					) : (
						<span className="text-muted-foreground">无</span>
					)}
				</dd>
				<dt className="text-muted-foreground">做过的事</dt>
				<dd>
					{s.did.length ? (
						s.did
							.map((d) =>
								d.involvement ? `${d.involvement} · ${d.domain}` : d.domain,
							)
							.join("、")
					) : (
						<span className="text-muted-foreground">无</span>
					)}
				</dd>
				{s.description && (
					<>
						<dt className="text-muted-foreground">描述</dt>
						<dd className="whitespace-pre-wrap">{s.description}</dd>
					</>
				)}
			</dl>
		</Card>
	);
}
