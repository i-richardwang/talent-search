import { useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import { confirmModal } from "#/components/ui/modal";
import { toast } from "#/components/ui/toast";
import type { Touch } from "#/ingestion/touch";
import {
	dropMember,
	recordTouch,
	reviseTouch,
} from "#/server/talent-functions";
import { emptyTouch, TouchFields } from "./touch-fields";

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
			{items.map((s) => (
				<Source key={s.id} s={s} personId={personId} />
			))}
		</section>
	);
}
function Source({ s, personId }: { s: Sources[number]; personId: string }) {
	const router = useRouter(),
		id = useId();
	const [periods, setPeriods] = useState(false);
	const [notes, setNotes] = useState(false);
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
			{s.latest && (
				<>
					<span>
						{[s.contacts.phone, s.contacts.email, s.contacts.wechat]
							.filter(Boolean)
							.join(" · ")}
					</span>
					<div>
						<CollapsibleTrigger
							open={notes}
							onOpenChange={setNotes}
							panelId={`${id}-notes`}
						>
							接触记录（{s.touches.length}）
						</CollapsibleTrigger>
						<Collapsible open={notes} id={`${id}-notes`}>
							<div className="grid gap-3">
								{s.touches.map((t) => (
									<TouchEntry key={t.id} entry={t} pool={s.pool_id} />
								))}
								<TouchForm
									save={async (touch) => {
										await recordTouch({
											data: { pool: s.pool_id, person: personId, touch },
										});
										await router.invalidate();
									}}
								/>
							</div>
						</Collapsible>
					</div>
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

function TouchForm({
	initial = emptyTouch,
	save,
}: {
	initial?: Touch;
	save: (value: Touch) => Promise<void>;
}) {
	const [value, setValue] = useState(initial);
	return (
		<div className="grid gap-2">
			<TouchFields value={value} onChange={setValue} />
			<Button
				size="small"
				disabled={!value.touched && !value.notes.trim()}
				onClick={async () => {
					try {
						await save(value);
						setValue(emptyTouch);
						toast.success("接触记录已保存");
					} catch {
						toast.error("接触记录未保存");
					}
				}}
			>
				{initial === emptyTouch ? "添加接触记录" : "保存修改"}
			</Button>
		</div>
	);
}
function TouchEntry({
	entry,
	pool,
}: {
	entry: Sources[number]["touches"][number];
	pool: string;
}) {
	const router = useRouter();
	const [editing, setEditing] = useState(false);
	async function revise(touch: Touch | null) {
		await reviseTouch({ data: { pool, id: entry.id, touch } });
		setEditing(false);
		await router.invalidate();
	}
	return (
		<article className="grid gap-1">
			<p>
				{entry.author} ·{" "}
				{entry.touched ?? `接触日期未填，登记于 ${entry.created}`}
			</p>
			{entry.notes && <p className="whitespace-pre-wrap">{entry.notes}</p>}
			{entry.canEdit && (
				<div className="flex gap-2">
					<Button size="small" onClick={() => setEditing(!editing)}>
						{editing ? "取消修改" : "修改记录"}
					</Button>
					<Button
						size="small"
						onClick={() =>
							confirmModal({
								title: "删除这条接触记录？",
								content: `${entry.author} 登记的这条记录将被删除，此操作无法撤销。`,
								okText: "删除记录",
								onOk: async () => {
									try {
										await revise(null);
									} catch (e) {
										toast.error("接触记录未删除");
										throw e;
									}
								},
							})
						}
					>
						删除记录
					</Button>
				</div>
			)}
			{editing && (
				<TouchForm
					initial={{ touched: entry.touched, notes: entry.notes }}
					save={revise}
				/>
			)}
		</article>
	);
}
