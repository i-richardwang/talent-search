import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Modal } from "#/components/ui/modal";
import type { Draft } from "../shared/tokens/draft";
import { ExportCode } from "./changes/export";
import { EXPORT_DIALOG_WIDTH } from "./layout";
import { MAX_NAME, MAX_SCHEMES } from "./storage";

/** 把当前的修改版存成一个方案：起个名字，存在这台浏览器里。 */
export function SaveSchemeDialog({
	count,
	onClose,
	onSave,
	open,
}: {
	/** 当前有几项修改。 */
	count: number;
	onClose: () => void;
	onSave: (name: string) => void;
	open: boolean;
}) {
	const [name, setName] = useState("");
	const save = () => {
		if (!name.trim()) return;
		onSave(name.trim());
		setName("");
	};
	return (
		<Modal noFooter onCancel={onClose} open={open} title="保存方案">
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					save();
				}}
			>
				<p className="text-fg-secondary text-sm">
					保存在这台浏览器里，最多 {MAX_SCHEMES} 个。现在有 {count} 项修改。
				</p>
				<label className="flex flex-col gap-2 text-sm" htmlFor="scheme-name">
					方案名称
					<Input
						autoFocus
						id="scheme-name"
						maxLength={MAX_NAME}
						onChange={(event) => setName(event.target.value)}
						placeholder="例如：更紧凑的名单"
						value={name}
					/>
				</label>
				<Button block disabled={!name.trim()} htmlType="submit" type="primary">
					保存方案
				</Button>
			</form>
		</Modal>
	);
}

/** 导出修改：和「CSS 导出」页同一份内容，放在对话框里。 */
export function ExportDialog({
	draft,
	onClose,
	onNotice,
	open,
}: {
	draft: Draft;
	onClose: () => void;
	onNotice: (message: string) => void;
	open: boolean;
}) {
	return (
		<Modal
			className={EXPORT_DIALOG_WIDTH}
			noFooter
			onCancel={onClose}
			open={open}
			title="导出修改"
		>
			<ExportCode draft={draft} onNotice={onNotice} />
		</Modal>
	);
}
