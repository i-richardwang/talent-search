import { useState } from "react";
import { emptyTouch, TouchFields } from "#/components/touch-fields";
import { Alert } from "#/components/ui/alert";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import {
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import { toast } from "#/components/ui/toast";
import { addResume } from "#/server/talent-functions";
import type { PoolSummary } from "#/server/talent-pools";

export function ResumeUpload({
	pools,
	selected,
	onPoolChange,
	onUploaded,
}: {
	pools: PoolSummary[];
	selected?: PoolSummary;
	onPoolChange: (id: string) => void;
	onUploaded: (id: string) => Promise<void>;
}) {
	const [touch, setTouch] = useState(emptyTouch);
	const [uploadError, setUploadError] = useState("");
	const [uploading, setUploading] = useState(false);
	async function upload(files: File[], poolId: string) {
		if (!files.length) return;
		setUploading(true);
		setUploadError("");
		try {
			const failed: string[] = [];
			for (const file of files) {
				const form = new FormData();
				form.set("pool", poolId);
				form.set("file", file);
				form.set("notes", touch.notes);
				if (touch.touched) form.set("touched", touch.touched);
				try {
					await addResume({ data: form });
				} catch {
					failed.push(file.name);
				}
			}
			if (failed.length) setUploadError(`上传失败：${failed.join("、")}`);
			if (failed.length < files.length) {
				toast.success(`${files.length - failed.length} 份简历已提交`);
				setTouch(emptyTouch);
				await onUploaded(poolId);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "上传未完成");
		} finally {
			setUploading(false);
		}
	}
	return (
		<>
			<Block
				variant="outlined"
				className="flex flex-wrap items-center gap-3 p-4"
			>
				<DropdownMenuRoot>
					<DropdownMenuTrigger>
						<Button disabled={uploading}>
							目标人才池 · {selected?.name ?? "选择"}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuPortal>
						<DropdownMenuPositioner>
							<DropdownMenuPopup>
								{renderDropdownMenuItems([
									{
										type: "radio",
										value: selected?.id ?? "",
										onValueChange: (id) => {
											onPoolChange(id);
										},
										options: pools.map((p) => ({
											value: p.id,
											label: p.name,
											extra: p.org_path ?? "所有登录账号",
										})),
									},
								])}
							</DropdownMenuPopup>
						</DropdownMenuPositioner>
					</DropdownMenuPortal>
				</DropdownMenuRoot>
				{selected && (
					<span className="text-fg-secondary text-sm">
						可见范围 · {selected.org_path ?? "所有登录账号"}
					</span>
				)}
				<form
					className="grid w-full gap-3"
					onSubmit={async (e) => {
						e.preventDefault();
						if (!selected || uploading) return;
						const form = e.currentTarget;
						const input = form.elements.namedItem("files") as HTMLInputElement;
						const files = Array.from(input.files ?? []);
						input.value = "";
						await upload(files, selected.id);
					}}
				>
					<label htmlFor="pool-upload">
						PDF 简历
						<Input
							id="pool-upload"
							name="files"
							required
							type="file"
							accept="application/pdf,.pdf"
							multiple
							disabled={!selected || uploading}
						/>
					</label>
					<TouchFields value={touch} onChange={setTouch} />
					<p className="text-sm text-fg-secondary">
						接触信息选填。批量上传时，每份简历分别记入这条接触记录。
					</p>
					<Button htmlType="submit" loading={uploading} disabled={!selected}>
						上传简历
					</Button>
				</form>
			</Block>
			{uploadError && (
				<Alert
					type="error"
					title={uploadError}
					onClose={() => setUploadError("")}
				/>
			)}
		</>
	);
}
