import { useRouter } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
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
	const router = useRouter();
	if (!items.length) return null;
	return (
		<section className="grid gap-2">
			<h3>简历原件</h3>
			{items.map((s, i) => (
				<div key={s.id} className="flex flex-wrap items-center gap-2">
					<span>
						{s.pool} · {s.filename} · {s.day} {s.uploader}
					</span>
					<Button
						size="small"
						render={
							<a
								href={`/api/resumes/${s.id}`}
								target="_blank"
								rel="noreferrer"
							/>
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
						<details>
							<summary>简历登记的任职时间</summary>
							{s.periods.map((e) => (
								<p key={[e.company, e.title, e.start, e.end].join("|")}>
									{e.company} {e.title} · {e.start} 至 {e.end}
								</p>
							))}
						</details>
					)}
					{items.findIndex((item) => item.pool_id === s.pool_id) === i && (
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
								<details>
									<summary>记录接触</summary>
									<form
										className="grid gap-2"
										onSubmit={async (e) => {
											e.preventDefault();
											const values = new FormData(e.currentTarget);
											try {
												await editContactNote({
													data: {
														pool: s.pool_id,
														person: personId,
														touched:
															String(values.get("touched") || "") || null,
														notes: String(values.get("notes") || ""),
													},
												});
												await router.invalidate();
												toast.success("接触记录已保存");
											} catch {
												toast.error("接触记录未保存");
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
										<Button size="small" htmlType="submit">
											保存
										</Button>
									</form>
								</details>
							)}
							{s.can_remove && (
								<Button
									size="small"
									onClick={() =>
										confirmModal({
											title: "从这个人才池移除？",
											content: "该池中的简历和联系方式将一起移除。",
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
			))}
		</section>
	);
}
