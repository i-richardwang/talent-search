import { useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Input } from "#/components/ui/input";
import { confirmModal } from "#/components/ui/modal";
import { toast } from "#/components/ui/toast";
import { dropMember, editContactNote } from "#/server/talent-functions";

type Sources = Awaited<
	ReturnType<typeof import("#/server/resume-files").sourcesFor>
>;
export function ResumeSources({
	items,
	personId,
}: {
	items: Sources;
	personId: string;
}) {
	if (!items.length) return null;
	return (
		<section className="grid gap-2">
			<h3>简历原件</h3>
			{items.map((s, i) => (
				<Source
					key={s.id}
					s={s}
					personId={personId}
					latest={items.findIndex((item) => item.pool_id === s.pool_id) === i}
				/>
			))}
		</section>
	);
}
function Source({
	s,
	personId,
	latest,
}: {
	s: Sources[number];
	personId: string;
	latest: boolean;
}) {
	const router = useRouter(),
		id = useId();
	const [periods, setPeriods] = useState(false),
		[notes, setNotes] = useState(false),
		[saving, setSaving] = useState(false);
	return (
		<div className="flex flex-wrap items-center gap-2">
			<span>
				{s.pool} · {s.filename} · {s.day} {s.uploader}
			</span>
			<Button
				size="small"
				render={
					<a href={`/api/resumes/${s.id}`} target="_blank" rel="noreferrer" />
				}
			>
				预览
			</Button>
			<Button
				size="small"
				render={<a href={`/api/resumes/${s.id}?download`} />}
			>
				下载
			</Button>
			{s.periods.length > 0 && (
				<div>
					<CollapsibleTrigger
						open={periods}
						onOpenChange={setPeriods}
						panelId={`${id}-periods`}
					>
						简历登记的任职时间
					</CollapsibleTrigger>
					<Collapsible id={`${id}-periods`} open={periods}>
						{s.periods.map((e) => (
							<p key={[e.company, e.title, e.start, e.end].join("|")}>
								{e.company} {e.title} · {e.start} 至 {e.end}
							</p>
						))}
					</Collapsible>
				</div>
			)}
			{latest && (
				<>
					<span>
						{[
							s.contacts.phone,
							s.contacts.email,
							s.contacts.wechat,
							s.touched && `最近接触 ${s.touched}`,
							s.notes,
						]
							.filter(Boolean)
							.join(" · ")}
					</span>
					{s.can_remove && (
						<div>
							<CollapsibleTrigger
								open={notes}
								onOpenChange={setNotes}
								panelId={`${id}-notes`}
							>
								记录接触
							</CollapsibleTrigger>
							<Collapsible id={`${id}-notes`} open={notes}>
								<form
									className="grid gap-2"
									onSubmit={async (e) => {
										e.preventDefault();
										if (saving) return;
										setSaving(true);
										const values = new FormData(e.currentTarget);
										try {
											await editContactNote({
												data: {
													pool: s.pool_id,
													person: personId,
													touched: String(values.get("touched") || "") || null,
													notes: String(values.get("notes") || ""),
												},
											});
											await router.invalidate();
											toast.success("接触记录已保存");
										} catch {
											toast.error("接触记录未保存");
										} finally {
											setSaving(false);
										}
									}}
								>
									<label htmlFor={`touch-${s.id}`}>最近接触日期</label>
									<Input
										id={`touch-${s.id}`}
										name="touched"
										type="date"
										defaultValue={s.touched ?? ""}
									/>
									<label htmlFor={`notes-${s.id}`}>接触备注</label>
									<Input
										id={`notes-${s.id}`}
										name="notes"
										maxLength={2000}
										defaultValue={s.notes}
									/>
									<Button size="small" loading={saving} htmlType="submit">
										保存
									</Button>
								</form>
							</Collapsible>
						</div>
					)}
					{s.can_remove && (
						<Button
							size="small"
							onClick={() =>
								confirmModal({
									title: "从这个人才池移除？",
									content: `将移除这名成员在「${s.pool}」中的所有简历、联系方式和接触记录。此操作无法撤销。`,
									okText: "移出人才池",
									onOk: async () => {
										try {
											await dropMember({
												data: { pool: s.pool_id, person: personId },
											});
											await router.invalidate();
										} catch (e) {
											toast.error("未能移出人才池");
											throw e;
										}
									},
								})
							}
						>
							移出人才池
						</Button>
					)}
				</>
			)}
		</div>
	);
}
