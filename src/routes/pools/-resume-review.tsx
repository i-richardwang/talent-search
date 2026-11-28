import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Segmented } from "#/components/ui/segmented";
import { EDUCATION_LADDER } from "#/corpus/contract";
import type { Match } from "#/identity/match";
import type { Decision } from "#/ingestion/publish";
import type { Resume } from "#/ingestion/resume";

const blank: Resume = {
	name: "",
	school: "",
	education: "",
	contacts: { phone: "", email: "", wechat: "" },
	experiences: [],
};
export function ResumeReview({
	initial,
	candidates,
	onDecision,
}: {
	initial: Resume | null;
	candidates: Match[];
	onDecision: (c: Decision) => void;
}) {
	const [draft, set] = useState<Resume>(initial ?? blank);
	return (
		<div className="grid gap-4 md:grid-cols-2">
			<Block variant="outlined" className="grid gap-3 p-4">
				<h3>本次简历</h3>
				<label htmlFor="resume-name">
					姓名
					<Input
						id="resume-name"
						value={draft.name}
						onChange={(e) => set({ ...draft, name: e.target.value })}
					/>
				</label>
				<label htmlFor="resume-school">
					学校
					<Input
						id="resume-school"
						value={draft.school}
						onChange={(e) => set({ ...draft, school: e.target.value })}
					/>
				</label>
				<Segmented
					aria-label="学历"
					value={draft.education}
					onChange={(education) => set({ ...draft, education })}
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
								set({
									...draft,
									contacts: { ...draft.contacts, [k]: e.target.value },
								})
							}
						/>
					</label>
				))}
				{draft.experiences.map((job, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: 核对表按原件顺序展示，只允许在末尾追加经历。
					<fieldset key={i} className="grid gap-2">
						<legend>工作经历 {i + 1}</legend>
						{(["company", "title", "start", "end", "description"] as const).map(
							(k, j) => (
								<label key={k} htmlFor={`job-${i}-${k}`}>
									{
										["公司", "岗位", "开始日期", "结束日期或至今", "职责原文"][
											j
										]
									}
									<Input
										id={`job-${i}-${k}`}
										value={job[k]}
										onChange={(e) =>
											set({
												...draft,
												experiences: draft.experiences.map((v, n) =>
													n === i ? { ...v, [k]: e.target.value } : v,
												),
											})
										}
									/>
								</label>
							),
						)}
					</fieldset>
				))}
				<Button
					onClick={() =>
						set({
							...draft,
							experiences: [
								...draft.experiences,
								{ company: "", title: "", start: "", end: "", description: "" },
							],
						})
					}
				>
					添加经历
				</Button>
				<Button onClick={() => onDecision({ action: "new", draft })}>
					作为独立人才入池
				</Button>
			</Block>
			<div className="flex flex-col gap-3">
				{candidates.map((m) => (
					<Block variant="outlined" key={m.personId} className="grid gap-2 p-4">
						<h3>已有档案 · {m.name}</h3>
						<p>{[m.school, m.education].filter(Boolean).join(" · ")}</p>
						{m.jobs.map((j) => (
							<p key={[j.company, j.title, j.start].join("|")}>
								{j.company} {j.title}（{j.start} 至 {j.end ?? "今"}）
							</p>
						))}
						<Button
							onClick={() =>
								onDecision({ action: "link", personId: m.personId, draft })
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
