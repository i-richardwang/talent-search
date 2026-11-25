/** 在用户操作中复制文本。普通 HTTP 通过浏览器的选区复制命令写入。 */
export async function copyText(text: string): Promise<void> {
	const { clipboard } = navigator;
	if (clipboard) return clipboard.writeText(text);

	const focused = document.activeElement;
	const selection = document.getSelection();
	const ranges = selection
		? Array.from({ length: selection.rangeCount }, (_, index) =>
				selection.getRangeAt(index),
			)
		: [];
	// 临时文本框放在当前弹窗内，以便在焦点受限时也能选中文本。
	const container = focused?.closest("dialog, [role=dialog]") ?? document.body;
	const field = document.createElement("textarea");
	field.value = text;
	field.readOnly = true;
	field.tabIndex = -1;
	Object.assign(field.style, {
		height: "1px",
		inset: "0 auto auto 0",
		opacity: "0",
		pointerEvents: "none",
		position: "fixed",
		width: "1px",
	});
	container.append(field);
	try {
		field.focus({ preventScroll: true });
		field.select();
		if (!document.execCommand("copy")) throw new Error("无法写入剪贴板");
	} finally {
		field.remove();
		if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
		if (selection) {
			selection.removeAllRanges();
			for (const range of ranges) selection.addRange(range);
		}
	}
}
