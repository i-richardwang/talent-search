import { useState } from "react";
import { emptyTouch, TouchFields } from "#/components/touch-fields";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Segmented } from "#/components/ui/segmented";
import { EDUCATION_LADDER } from "#/corpus/contract";
import type { IdentityCandidate } from "#/identity/match";
import type { Decision } from "#/ingestion/decision";
import type { Resume } from "#/ingestion/resume";
import type { Touch } from "#/ingestion/touch";

const blank: Resume = {
	name: "",
	school: "",
	education: "",
	contacts: { phone: "", email: "", wechat: "" },
	experiences: [],
};
export function ResumeReview({
	initial,
	initialTouch,
	taskId,
	candidates,
	onDecision,
}: {
	initial: Resume | null;
	initialTouch: Touch | null;
	taskId: string;
	candidates: IdentityCandidate[];
	onDecision: (c: Decision) => Promise<void>;
}) {
	const [touch, setTouch] = useState(initialTouch ?? emptyTouch);
	const [profile, setProfile] = useState(() => {
		const { experiences: _, ...fields } = initial ?? blank;
		return fields;
	});
	const [jobs, setJobs] = useState(() =>
		(initial ?? blank).experiences.map((value) => ({
			id: crypto.randomUUID(),
			value,
		})),
	);
	const draft: Resume = {
		...profile,
		experiences: jobs.map((job) => job.value),
	};
	function updateJob(
		id: string,
		key: keyof Resume["experiences"][number],
		value: string,
	) {
		setJobs((current) =>
			current.map((job) =>
				job.id === id ? { ...job, value: { ...job.value, [key]: value } } : job,
			),
		);
	}
	return (
		<div className="grid gap-4 md:grid-cols-2">
			<Block variant="outlined" className="grid gap-3 p-4">
				<div className="flex items-center justify-between gap-2">
					<h3>本次简历</h3>
					<Button
						size="small"
						render={
							<a
								href={`/api/resumes/pending/${encodeURIComponent(taskId)}`}
								target="_blank"
								rel="noreferrer"
							/>
						}
					>
						预览本次原件
					</Button>
				</div>
				<label htmlFor="resume-name">
					姓名
					<Input
						id="resume-name"
						value={draft.name}
						onChange={(e) => setProfile({ ...profile, name: e.target.value })}
					/>
				</label>
				<label htmlFor="resume-school">
					学校
					<Input
						id="resume-school"
						value={draft.school}
						onChange={(e) => setProfile({ ...profile, school: e.target.value })}
					/>
				</label>
				<Segmented
					aria-label="学历"
					value={draft.education}
					onChange={(education) => setProfile({ ...profile, education })}
					options={[
						{ value: "", label: "学历未知" },
						...EDUCATION_LADDER.map((value) => ({ value, label: value })),
					]}
				/>
				{(["phone", "email", "wechat"] as const).map((k, i) => (
					<label key={k} htmlFor={`contact-${k}`}>
						{["电话", "邮箱", "微信"][i]}
						<Input
							id={`contact-${k}`}
							value={draft.contacts[k]}
							onChange={(e) =>
								setProfile({
									...profile,
									contacts: { ...draft.contacts, [k]: e.target.value },
								})
							}
						/>
					</label>
				))}
				<p className="text-sm text-fg-secondary">
					无明确时间的项目可按上下文并入对应工作段的职责描述。
				</p>
				{jobs.map(({ id, value: job }, i) => (
					<fieldset key={id} className="grid gap-2">
						<legend>工作经历 {i + 1}</legend>
						{(
							[
								["company", "公司"],
								["title", "岗位"],
								["start", "开始日期"],
								["end", "结束日期或至今"],
							] as const
						).map(([key, label]) => (
							<label key={key} htmlFor={`job-${id}-${key}`}>
								{label}
								<Input
									id={`job-${id}-${key}`}
									value={job[key]}
									onChange={(e) => updateJob(id, key, e.target.value)}
								/>
							</label>
						))}
						<label htmlFor={`job-${id}-description`}>职责原文</label>
						<textarea
							id={`job-${id}-description`}
							rows={4}
							className="ui-input-root ui-input-auto resize-y px-3 py-2 text-sm"
							value={job.description}
							onChange={(e) => updateJob(id, "description", e.target.value)}
						/>
						<Button
							size="small"
							type="text"
							aria-label={`删除第 ${i + 1} 段经历`}
							onClick={() =>
								setJobs((current) => current.filter((job) => job.id !== id))
							}
						>
							删除这段经历
						</Button>
					</fieldset>
				))}
				<Button
					onClick={() => {
						const job = {
							id: crypto.randomUUID(),
							value: {
								company: "",
								title: "",
								start: "",
								end: "",
								description: "",
							},
						};
						setJobs((current) => [...current, job]);
					}}
				>
					添加经历
				</Button>
				<TouchFields value={touch} onChange={setTouch} />
				<Button onClick={() => onDecision({ action: "new", draft, touch })}>
					作为独立人才入池
				</Button>
			</Block>
			<div className="flex flex-col gap-3">
				{candidates.map((m) => (
					<Block variant="outlined" key={m.personId} className="grid gap-2 p-4">
						<h3>已有档案 · {m.name}</h3>
						<p>{[m.school, m.education].filter(Boolean).join(" · ")}</p>
						{m.jobs.map((j) => (
							<p key={j.id}>
								{j.company} {j.title}（{j.start} 至 {j.end ?? "今"}）
							</p>
						))}
						<Button
							onClick={() =>
								onDecision({
									action: "link",
									personId: m.personId,
									draft,
									touch,
								})
							}
						>
							是同一人，关联这份简历
						</Button>
					</Block>
				))}
				<Button onClick={() => onDecision({ action: "cancel" })}>
					放弃导入
				</Button>
			</div>
		</div>
	);
}
